// index.js - Fully refactored for relational database

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// A simple route to test that the server is working
app.get('/', (req, res) => {
  res.send('Welcome to the Ojakh Recipe API!');
});

// --- CREATE A NEW RECIPE ---
// This is now a database transaction to ensure all or nothing is saved.
app.post('/ojakh/recipes', async (req, res) => {
  const { title, category, cover_image_url, ingredients, steps } = req.body;
  const client = await pool.connect(); // Get a client from the connection pool for the transaction

  try {
    await client.query('BEGIN'); // Start the transaction

    // 1. Insert the main recipe and get its new ID
    const recipeQuery = 'INSERT INTO recipes (title, category, cover_image_url, steps) VALUES ($1, $2, $3, $4) RETURNING id';
    const recipeResult = await client.query(recipeQuery, [title, category, cover_image_url, JSON.stringify(steps)]);
    const recipeId = recipeResult.rows[0].id;

    // 2. Handle all ingredients
    for (const ing of ingredients) {
      if (ing.name) { // Only process if ingredient has a name
        // a. "Upsert" the ingredient: Insert if it's new, or do nothing if it exists, but always return its ID.
        const ingQuery = 'INSERT INTO ingredients (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id';
        const ingResult = await client.query(ingQuery, [ing.name.toLowerCase()]);
        const ingredientId = ingResult.rows[0].id;

        // b. Link the recipe and ingredient in the join table with its amount
        const recipeIngQuery = 'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount) VALUES ($1, $2, $3)';
        await client.query(recipeIngQuery, [recipeId, ingredientId, ing.amount]);
      }
    }

    await client.query('COMMIT'); // Commit the transaction if everything was successful
    res.status(201).json({ id: recipeId, title });

  } catch (err) {
    await client.query('ROLLBACK'); // Roll back the transaction if any step failed
    console.error('Error in transaction, rolled back.', err.stack);
    res.status(500).send('Server error during recipe creation.');
  } finally {
    client.release(); // Release the client back to the pool
  }
});


// --- READ ALL RECIPES (List View) ---
// This is now simpler as it doesn't need to worry about ingredients.
app.get('/ojakh/recipes', async (req, res) => {
  try {
    const allRecipes = await pool.query("SELECT id, title, category, cover_image_url FROM recipes ORDER BY created_at DESC");
    res.json(allRecipes.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- READ A SINGLE RECIPE (Detail View) ---
// This now uses a JOIN to gather all related ingredients.
app.get('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Fetch main recipe details
    const recipeResult = await pool.query("SELECT * FROM recipes WHERE id = $1", [id]);
    if (recipeResult.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    const recipe = recipeResult.rows[0];

    // 2. Fetch linked ingredients and their amounts
    const ingredientsQuery = `
      SELECT i.name, ri.amount 
      FROM ingredients i 
      JOIN recipe_ingredients ri ON i.id = ri.ingredient_id 
      WHERE ri.recipe_id = $1
    `;
    const ingredientsResult = await pool.query(ingredientsQuery, [id]);
    
    // 3. Combine and send the final object
    recipe.ingredients = ingredientsResult.rows;
    res.json(recipe);

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// --- UPDATE AN EXISTING RECIPE ---
// This is also a transaction to ensure data integrity.
app.put('/ojakh/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, category, cover_image_url, ingredients, steps } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update the main recipe details
    const recipeQuery = 'UPDATE recipes SET title = $1, category = $2, cover_image_url = $3, steps = $4 WHERE id = $5';
    await client.query(recipeQuery, [title, category, cover_image_url, JSON.stringify(steps), id]);

    // 2. Delete the old ingredient links for this recipe
    await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
    
    // 3. Re-add all the ingredients, just like in the CREATE function
    for (const ing of ingredients) {
      if (ing.name) {
        const ingQuery = 'INSERT INTO ingredients (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id';
        const ingResult = await client.query(ingQuery, [ing.name.toLowerCase()]);
        const ingredientId = ingResult.rows[0].id;

        const recipeIngQuery = 'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount) VALUES ($1, $2, $3)';
        await client.query(recipeIngQuery, [id, ingredientId, ing.amount]);
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ id, title });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in transaction, rolled back.', err.stack);
    res.status(500).send('Server error during recipe update.');
  } finally {
    client.release();
  }
});


// --- DELETE A RECIPE ---
// This is now much simpler because "ON DELETE CASCADE" in the database does the hard work.
app.delete('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteOp = await pool.query("DELETE FROM recipes WHERE id = $1 RETURNING title", [id]);
    if (deleteOp.rowCount === 0) {
      return res.status(404).send("Recipe not found.");
    }
    res.json({ message: `Recipe '${deleteOp.rows[0].title}' deleted successfully` });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// --- GET ALL UNIQUE INGREDIENTS ---
// This is much simpler now, just selecting from the new table.
app.get('/ojakh/ingredients', async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM ingredients ORDER BY name ASC");
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// --- FIND RECIPES BY INGREDIENTS (Smart Search) ---
// The query is now different, but the idea is the same.
app.post('/recipes/find-by-ingredients', async (req, res) => {
  try {
    const { myIngredients } = req.body;
    if (!myIngredients || myIngredients.length === 0) {
      return res.json([]);
    }

    // This query finds all recipes where the count of matching ingredients
    // is equal to the total number of ingredients required for that recipe.
    const query = `
      SELECT r.*
      FROM recipes r
      WHERE NOT EXISTS (
        SELECT 1
        FROM recipe_ingredients ri
        JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.recipe_id = r.id AND i.name NOT IN (SELECT unnest($1::text[]))
      );
    `;

    const recipesResult = await pool.query(query, [myIngredients]);
    res.json(recipesResult.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- NVAG ---

// GET: Fetch all chords from the database
app.get('/nvag/chords', async (req, res) => {
  try {
    // Query the database to get all rows from the 'chords' table
    const allChords = await nvagPool.query("SELECT * FROM chords ORDER BY name ASC");
    
    // Send the results back as a JSON response
    res.status(200).json(allChords.rows);

  } catch (err) {
    console.error("Error fetching chords:", err.message);
    res.status(500).send("Server Error");
  }
});

// Export the app for Vercel
module.exports = app;
