const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, SERVER_PORT, SERVER_URL, FREE_MOBILE_USER, FREE_MOBILE_TOKEN } = process.env;

let db;
async function initDatabase() {
  try {
    db = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });

    console.log("✅ Connected to the database!");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
  }
}

const tempLinks = new Map();

app.get('/getLink', (req, res) => {
  const uniqueKey = crypto.randomBytes(16).toString('hex');
  const tempUrl = `/members/${uniqueKey}`;

  tempLinks.set(uniqueKey, { used: false, expires: Date.now() + 10 * 60 * 1000 });

  sendSmsAlert(`Link to connect to panel : ${SERVER_URL}${tempUrl}`);

  res.send("Lien envoyé");
});

function validateLink(req, res, next) {
  const key = req.params.key;

  if (!tempLinks.has(key)) {
    return res.status(403).send("⛔ Lien invalide ou expiré.");
  }

  const linkData = tempLinks.get(key);

  if (linkData.used || Date.now() > linkData.expires) {
    tempLinks.delete(key);
    return res.status(403).send("⛔ Lien déjà utilisé ou expiré.");
  }

  linkData.used = true;
  next();
}

app.get('/members/:key', validateLink, async (req, res) => {
  try {
    initDatabase();
    const [members] = await db.query('SELECT * FROM Membre');

    members.sort((a, b) => {
      const roleOrder = { "sudo": 1, "admin": 2, "manager": 3 , "operator": 4, "cashier": 5, "contributor": 6, "member": 7};
      return (roleOrder[a.specialRole] || 8) - (roleOrder[b.specialRole] || 8);
    });

    const newKey = crypto.randomBytes(16).toString('hex');
    tempLinks.set(newKey, { used: false, expires: Date.now() + 10 * 60 * 1000 });

    res.render('members', { members, tempKey: newKey });
  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).send("Erreur serveur");
  }
});

app.post('/update-specialRole/:key', validateLink, async (req, res) => {
  let { id, nom, prenom, specialRole } = req.body;

  sendSmsAlert(`${prenom} ${nom} a changé de rôle ! Nouveau rôle: ${specialRole}`);

  console.log(`🔹 Mise à jour du rôle de ${id} : ${specialRole}`);

  if (specialRole === 'member') {
    specialRole = null;
  }

  try {
    await db.query('UPDATE Membre SET specialRole = ? WHERE id = ?', [specialRole, id]);

    const newKey = crypto.randomBytes(16).toString('hex');
    tempLinks.set(newKey, { used: false, expires: Date.now() + 10 * 60 * 1000 });

    res.redirect(`/members/${newKey}`);
  } catch (err) {
    console.error("❌ Error updating role:", err);
    res.status(500).send("Erreur lors de la mise à jour du rôle.");
  }
});

function sendSmsAlert(message) {
  if (!FREE_MOBILE_USER || !FREE_MOBILE_TOKEN) {
    console.error('❌ Missing SMS credentials!');
    return;
  }

  const url = `https://smsapi.free-mobile.fr/sendmsg?user=${FREE_MOBILE_USER}&pass=${FREE_MOBILE_TOKEN}&msg=${encodeURIComponent(message)}`;
  axios.get(url);
}

initDatabase().then(() => {
  app.listen(SERVER_PORT, () => {
    console.log(`🚀 Server running on ${SERVER_URL}`);
  });
});