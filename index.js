require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

const nvagPool = new Pool({
  connectionString: process.env.NVAG_DATABASE_URL,
});

const ojakhPool = new Pool({
  connectionString: process.env.OJAKH_DATABASE_URL,
});

app.get('/', (req, res) => {
  res.send('Welcome to the Ojakh Recipe API!');
});

// --- CREATE A NEW RECIPE ---
app.post('/ojakh/recipes', async (req, res) => {
  const { title, category, cover_image_url, ingredients, steps } = req.body;
  const client = await ojakhPool.connect();

  try {
    await client.query('BEGIN');

    const recipeQuery = 'INSERT INTO recipes (title, category, cover_image_url, steps) VALUES ($1, $2, $3, $4) RETURNING id';
    const recipeResult = await client.query(recipeQuery, [title, category, cover_image_url, JSON.stringify(steps)]);
    const recipeId = recipeResult.rows[0].id;

    for (const ing of ingredients) {
      if (ing.name) {
        const ingQuery = 'INSERT INTO ingredients (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id';
        const ingResult = await client.query(ingQuery, [ing.name.toLowerCase()]);
        const ingredientId = ingResult.rows[0].id;

        const recipeIngQuery = 'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount) VALUES ($1, $2, $3)';
        await client.query(recipeIngQuery, [recipeId, ingredientId, ing.amount]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: recipeId, title });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in transaction, rolled back.', err.stack);
    res.status(500).send('Server error during recipe creation.');
  } finally {
    client.release();
  }
});


// --- READ ALL RECIPES (List View) ---
app.get('/ojakh/recipes', async (req, res) => {
  try {
    const allRecipes = await ojakhPool.query("SELECT id, title, category, cover_image_url FROM recipes ORDER BY created_at DESC");
    res.json(allRecipes.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- READ A SINGLE RECIPE (Detail View) ---
app.get('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const recipeResult = await ojakhPool.query("SELECT * FROM recipes WHERE id = $1", [id]);
    if (recipeResult.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    const recipe = recipeResult.rows[0];

    const ingredientsQuery = `
      SELECT i.name, ri.amount 
      FROM ingredients i 
      JOIN recipe_ingredients ri ON i.id = ri.ingredient_id 
      WHERE ri.recipe_id = $1
    `;
    const ingredientsResult = await ojakhPool.query(ingredientsQuery, [id]);
    
    recipe.ingredients = ingredientsResult.rows;
    res.json(recipe);

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// --- UPDATE AN EXISTING RECIPE ---
app.put('/ojakh/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, category, cover_image_url, ingredients, steps } = req.body;
  const client = await ojakhPool.connect();

  try {
    await client.query('BEGIN');

    const recipeQuery = 'UPDATE recipes SET title = $1, category = $2, cover_image_url = $3, steps = $4 WHERE id = $5';
    await client.query(recipeQuery, [title, category, cover_image_url, JSON.stringify(steps), id]);

    await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [id]);
    
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
app.delete('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteOp = await ojakhPool.query("DELETE FROM recipes WHERE id = $1 RETURNING title", [id]);
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
app.get('/ojakh/ingredients', async (req, res) => {
  try {
    const result = await ojakhPool.query("SELECT name FROM ingredients ORDER BY name ASC");
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// --- FIND RECIPES BY INGREDIENTS (Smart Search) ---
app.post('/ojakh/recipes/find-by-ingredients', async (req, res) => {
  try {
    const { myIngredients } = req.body;
    if (!myIngredients || myIngredients.length === 0) {
      return res.json([]);
    }

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

    const recipesResult = await ojakhPool.query(query, [myIngredients]);
    res.json(recipesResult.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.get('/ojakh/categories', async (req, res) => {
  try {
    // This SQL query selects each unique category only once
    const categoryResult = await ojakhPool.query(
      "SELECT DISTINCT category FROM recipes WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC"
    );
    // The result is an array of objects, so we map it to a simple array of strings
    const categories = categoryResult.rows.map(row => row.category);
    res.json(categories);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- NVAG ---

// GET: Fetch all chords from the database
app.get('/nvag/chords', async (req, res) => {
  try {
    const allChords = await nvagPool.query("SELECT * FROM chords ORDER BY name ASC");
    
    res.status(200).json(allChords.rows);

  } catch (err) {
    console.error("Error fetching chords:", err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = app;
