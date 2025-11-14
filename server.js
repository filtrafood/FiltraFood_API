// --- 1. LES OUTILS (Les "imports") ---
const express = require('express');    // Pour créer le serveur web
const cors = require('cors');        // Pour autoriser l'app mobile à appeler
const fs = require('fs');          // Pour lire les fichiers (fs = file system)
const path = require('path');      // Pour gérer les chemins de fichiers

// --- 2. CONFIGURATION ---
const app = express(); // On crée l'application serveur
app.use(cors());       // On l'autorise à recevoir des appels de l'extérieur
const PORT = 3000;     // Le "port" sur lequel le Cerveau écoute

// --- 3. CHARGER LES BASES DE DONNÉES AU DÉMARRAGE ---
const db = {}; // Un objet vide pour stocker nos listes
const dbPath = path.join(__dirname, 'databases');

try {
  // On lit le contenu du dossier "databases"
  const files = fs.readdirSync(dbPath);

  files.forEach(file => {
    if (file.endsWith('.json')) {
      // On lit le contenu du fichier
      const filePath = path.join(dbPath, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      
      // On le "parse" (transforme en objet JS) et on le stocke
      // ex: db['db_vegan'] = { name: "Filtre Végan", keywords: [...] }
      const dbName = path.basename(file, '.json');
      db[dbName] = JSON.parse(fileContent);
    }
  });

  console.log('Bases de données chargées :', Object.keys(db)); // Affiche [ 'db_halal', 'db_vegan', ... ]

} catch (error) {
  console.error('ERREUR: Impossible de charger les bases de données !', error);
  process.exit(1); // On quitte si on ne peut pas charger les filtres
}

// --- 4. LA ROUTE PRINCIPALE (Le "check") ---
// C'est ici que l'application va appeler
app.get('/check', async (req, res) => {
  
  // 1. Récupérer les infos de l'URL (ex: ?barcode=...&filtres=...)
  const { barcode, filtres } = req.query;

  // Sécurité : si le code-barres ou les filtres sont absents
  if (!barcode || !filtres) {
    return res.status(400).json({ 
      status: 'Erreur', 
      cause: 'Code-barres ou filtres manquants' 
    });
  }

  // 2. Transformer les filtres (ex: "db_vegan,db_halal") en tableau [ 'db_vegan', 'db_halal' ]
  const activeFilterKeys = filtres.split(',');

  console.log(`Scan reçu pour ${barcode} avec filtres: ${activeFilterKeys}`);

  try {
    // 3. Appeler Open Food Facts
    const offResponse = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    const offData = await offResponse.json();

    // 4. Vérifier si le produit a été trouvé
    if (offData.status !== 1 || !offData.product) {
      return res.json({
        status: 'Inconnu',
        cause: "Produit non trouvé dans Open Food Facts."
      });
    }

    const product = offData.product;
    const productName = product.product_name || 'Produit Inconnu';
    
    // --- MODIFICATION IMPORTANTE (LA CORRECTION) ---
    // On cherche les ingrédients en FR, sinon en EN, sinon le champ par défaut.
    // S'il n'y a rien, on met une chaîne vide pour éviter le plantage.
    const ingredientsText = (
      product.ingredients_text_fr || 
      product.ingredients_text_en || 
      product.ingredients_text || 
      ""
    ).toLowerCase(); // On met tout en minuscule pour la comparaison
    
    if (!ingredientsText) {
      return res.json({
        status: 'Inconnu',
        productName: productName,
        cause: "Aucune liste d'ingrédients disponible pour ce produit."
      });
    }
    // --- FIN DE LA CORRECTION ---

    // 5. Vérifier les filtres
    let finalStatus = 'OK'; // Statut par défaut
    let finalCause = 'Ce produit semble compatible avec vos filtres.';

    // On boucle sur chaque filtre demandé (ex: 'db_vegan', 'db_halal')
    for (const key of activeFilterKeys) {
      // On vérifie que ce filtre existe dans notre 'db'
      if (db[key] && db[key].keywords) {
        
        // On cherche le premier mot-clé interdit qu'on trouve
        const foundKeyword = db[key].keywords.find(keyword => 
          ingredientsText.includes(keyword.toLowerCase())
        );

        if (foundKeyword) {
          // ON A TROUVÉ UN PROBLÈME !
          finalStatus = `Non ${db[key].name || key}`; // ex: "Non Filtre Végan"
          finalCause = `Contient : ${foundKeyword}`;
          break; // On arrête de chercher, on a trouvé une incompatibilité
        }
      }
    }

    // 6. Renvoyer la réponse à l'application mobile
    res.json({
      status: finalStatus,
      productName: productName,
      cause: finalCause
    });

  } catch (error) {
    console.error('ERREUR PENDANT LE CHECK:', error);
    res.status(500).json({ 
      status: 'Erreur Serveur', 
      cause: 'Le Cerveau a rencontré un problème.' 
    });
  }
});

// --- 5. DÉMARRER LE SERVEUR ---
app.listen(PORT, () => {
  console.log('Serveur FiltraFood (le Cerveau) est démarré !');
  console.log(`Il écoute sur http://localhost:${PORT}`);
});
