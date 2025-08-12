// Import required packages
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

// Create the Express app
const app = express();
// Increase the JSON payload limit for images and complex recipes
app.use(express.json({ limit: '5mb' }));

// Pool for the Ojakh (recipes) database
const ojakhPool = new Pool({
  connectionString: process.env.OJAKH_DATABASE_URL, // Use a specific env variable
});

// Pool for the NVAG (chords) database
const nvagPool = new Pool({
  connectionString: process.env.NVAG_DATABASE_URL, // Use a specific env variable
});

// A simple route to test that the server is working
app.get('/', (req, res) => {
  res.send('Welcome to the Ojakh Recipe API!');
});

// --- OJAKH ---

// CREATE: Add a new recipe
app.post('/ojakh/recipes', async (req, res) => {
  try {
    const { title, category, cover_image_url, ingredients, steps } = req.body;
    const newRecipe = await ojakhPool.query(
      "INSERT INTO recipes (title, category, cover_image_url, ingredients, steps) VALUES($1, $2, $3, $4, $5) RETURNING *",
      [
        title,
        category,
        cover_image_url,
        JSON.stringify(ingredients), // Convert ingredients to a JSON string
        JSON.stringify(steps),       // Convert steps to a JSON string
      ]
    );
    res.status(201).json(newRecipe.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get all recipes (just main fields, not full details)
app.get('/ojakh/recipes', async (req, res) => {
  try {
    // We only select key fields for the list view to keep it fast
    const allRecipes = await ojakhPool.query("SELECT id, title, category, cover_image_url FROM recipes ORDER BY created_at DESC");
    res.json(allRecipes.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get a single recipe by ID (with all details)
app.get('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const recipeResult = await ojakhPool.query("SELECT * FROM recipes WHERE id = $1", [id]);

    if (recipeResult.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }

    const recipe = recipeResult.rows[0];
    res.json(recipe); // Send the recipe object directly

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get all unique categories
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

// UPDATE: Edit a recipe by ID
app.put('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, cover_image_url, ingredients, steps } = req.body;

    // The fix is to explicitly stringify the JSON fields
    const updateRecipe = await ojakhPool.query(
      "UPDATE recipes SET title = $1, category = $2, cover_image_url = $3, ingredients = $4, steps = $5 WHERE id = $6 RETURNING *",
      [
        title,
        category,
        cover_image_url,
        JSON.stringify(ingredients), // Convert ingredients to a JSON string
        JSON.stringify(steps),       // Convert steps to a JSON string
        id
      ]
    );

    if (updateRecipe.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    res.json(updateRecipe.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// DELETE: Remove a recipe by ID
app.delete('/ojakh/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteRecipe = await ojakhPool.query("DELETE FROM recipes WHERE id = $1 RETURNING *", [id]);
    if (deleteRecipe.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    res.json({ message: "Recipe deleted successfully" });
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
