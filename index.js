// Import required packages
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

// Create the Express app
const app = express();
// Increase the JSON payload limit for images and complex recipes
app.use(express.json({ limit: '5mb' }));

// Create a new PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// A simple route to test that the server is working
app.get('/', (req, res) => {
  res.send('Welcome to the Krakaran Recipe API!');
});

// CREATE: Add a new recipe
app.post('/recipes', async (req, res) => {
  try {
    const { title, category, cover_image_url, ingredients, steps } = req.body;
    const newRecipe = await pool.query(
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
app.get('/recipes', async (req, res) => {
  try {
    // We only select key fields for the list view to keep it fast
    const allRecipes = await pool.query("SELECT id, title, category, cover_image_url FROM recipes ORDER BY created_at DESC");
    res.json(allRecipes.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get a single recipe by ID (with all details)
app.get('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const recipe = await pool.query("SELECT * FROM recipes WHERE id = $1", [id]);
    if (recipe.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    res.json(recipe.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// UPDATE: Edit a recipe by ID
app.put('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, cover_image_url, ingredients, steps } = req.body;

    // The fix is to explicitly stringify the JSON fields
    const updateRecipe = await pool.query(
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
app.delete('/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteRecipe = await pool.query("DELETE FROM recipes WHERE id = $1 RETURNING *", [id]);
    if (deleteRecipe.rows.length === 0) {
      return res.status(404).send("Recipe not found.");
    }
    res.json({ message: "Recipe deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Export the app for Vercel
module.exports = app;