const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let db;

async function connectDB() {
    if (db) return db;

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.DB_NAME);

    return db;
}

app.get('/api/ping', async (req, res) => {
    try {
        await connectDB();
        res.json({ status: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;