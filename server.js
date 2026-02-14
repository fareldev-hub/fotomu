const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

// Path Adaptif: Menggunakan /tmp untuk Vercel (Ephemeral Storage)
const ROOT_DIR = process.env.VERCEL ? "/tmp" : __dirname;
const FOTO_DIR = path.join(ROOT_DIR, "fotomu");
const FAV_DIR = path.join(FOTO_DIR, "Favorit");

// Inisialisasi Folder secara Rekursif
if (!fs.existsSync(FOTO_DIR)) fs.mkdirSync(FOTO_DIR, { recursive: true });
if (!fs.existsSync(FAV_DIR)) fs.mkdirSync(FAV_DIR, { recursive: true });

// Konfigurasi Penyimpanan Multer
const storage = multer.diskStorage({
  destination: FOTO_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan File Statis dari folder public (HTML, CSS, JS frontend)
app.use(express.static(path.join(__dirname, "public")));

/**
 * FIX UNTUK VERCEL: 
 * Route khusus untuk melayani file gambar dari folder /tmp.
 * Tanpa route ini, gambar yang diupload ke /tmp akan tampil BLANK di Vercel.
 */
app.get("/fotomu/:folder?/:filename", (req, res) => {
  const { folder, filename } = req.params;
  let filePath;

  // Jika folder kedua ada, berarti mengakses Favorit (fotomu/Favorit/file.jpg)
  if (filename && folder && folder.toLowerCase() === 'favorit') {
    filePath = path.join(FAV_DIR, filename);
  } else {
    // Jika hanya satu params, berarti folder utama (fotomu/file.jpg)
    filePath = path.join(FOTO_DIR, folder || filename);
  }

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("File tidak ditemukan");
  }
});

// Ambil List Foto (Mendukung Subfolder)
app.get("/cek-foto", (req, res) => {
  const folder = req.query.folder || "";
  const targetPath = path.join(FOTO_DIR, folder);
  
  if (!fs.existsSync(targetPath)) return res.json([]);
  
  try {
    const files = fs.readdirSync(targetPath).filter(f => {
      return fs.lstatSync(path.join(targetPath, f)).isFile();
    });
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// Fitur Like (Pindahkan file fisik ke folder Favorit)
app.post("/like/:nama", (req, res) => {
  const oldPath = path.join(FOTO_DIR, req.params.nama);
  const newPath = path.join(FAV_DIR, req.params.nama);
  
  try {
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "File tidak ditemukan" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Banyak Foto (Maksimal 20)
app.post("/upload", upload.array("foto", 20), (req, res) => {
  res.redirect("/");
});

// Download ZIP (Pilihan atau Semua)
app.post("/download-zip", (req, res) => {
  const { files, folder } = req.body;
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  res.attachment(`backup-${folder || 'semua'}.zip`);
  archive.pipe(res);
  
  const targetDir = path.join(FOTO_DIR, folder || "");
  
  if (files && files.length > 0) {
    files.forEach(f => {
      const p = path.join(targetDir, f);
      if (fs.existsSync(p)) archive.file(p, { name: f });
    });
  } else {
    if (fs.existsSync(targetDir)) {
      archive.directory(targetDir, false);
    }
  }
  archive.finalize();
});

// Hapus Foto
app.post("/hapus", (req, res) => {
  const { nama, folder } = req.body;
  const filePath = path.join(FOTO_DIR, folder || "", nama);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "File tidak ditemukan" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan Server lokal jika bukan di production
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Album jalan di port ${PORT}`));
}

// Ekspor aplikasi untuk Vercel Serverless Functions
module.exports = app;