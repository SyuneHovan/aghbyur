// Import required packages
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); // <-- Import the pg Pool

// Create the Express app
const app = express();
const port = 3000;

// Create a new PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// This middleware is needed to parse JSON from the request body
app.use(express.json());

// A simple route to test that the server is working
app.get('/', (req, res) => {
  res.send('Welcome to the CRUD API!');
});

// CREATE: Add a new task
app.post('/tasks', async (req, res) => {
  try {
    const { description } = req.body;
    const newTask = await pool.query(
      "INSERT INTO tasks (description) VALUES($1) RETURNING *",
      [description]
    );
    res.status(201).json(newTask.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get all tasks
app.get('/tasks', async (req, res) => {
  try {
    const allTasks = await pool.query("SELECT * FROM tasks ORDER BY id ASC");
    res.json(allTasks.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// READ: Get a single task by ID
app.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const task = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);

    if (task.rows.length === 0) {
      return res.status(404).send("Task not found.");
    }
    
    res.json(task.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// UPDATE: Edit a task by ID
app.put('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, completed } = req.body;

    const updateTask = await pool.query(
      "UPDATE tasks SET description = $1, completed = $2 WHERE id = $3 RETURNING *",
      [description, completed, id]
    );

    if (updateTask.rows.length === 0) {
      return res.status(404).send("Task not found.");
    }

    res.json(updateTask.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// DELETE: Remove a task by ID
app.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleteTask = await pool.query("DELETE FROM tasks WHERE id = $1 RETURNING *", [id]);

    if (deleteTask.rows.length === 0) {
      return res.status(404).send("Task not found.");
    }

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Start the server (not needed for vercel)
// app.listen(port, () => {
//   console.log(`Server is running on http://localhost:${port}`);
// });

// Export the app for Vercel
module.exports = app;