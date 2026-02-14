const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 3000;

// Path Adaptif: Vercel (/tmp) atau Lokal (__dirname)
const ROOT_DIR = process.env.VERCEL ? "/tmp" : __dirname;
const FOTO_DIR = path.join(ROOT_DIR, "fotomu");
const FAV_DIR = path.join(FOTO_DIR, "Favorit");

// Inisialisasi Folder
[FOTO_DIR, FAV_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: FOTO_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.use(express.static("public"));
app.use("/fotomu", express.static(FOTO_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ambil List Foto
app.get("/cek-foto", (req, res) => {
  const folder = req.query.folder || "";
  const targetPath = path.join(FOTO_DIR, folder);
  
  if (!fs.existsSync(targetPath)) return res.json([]);
  
  const files = fs.readdirSync(targetPath).filter(f => {
    return fs.lstatSync(path.join(targetPath, f)).isFile();
  });
  res.json(files);
});

// Fitur Like (Pindah ke Favorit)
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

// Upload
app.post("/upload", upload.array("foto", 20), (req, res) => {
  res.redirect("/");
});

// Download ZIP
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
    archive.directory(targetDir, false);
  }
  archive.finalize();
});

// Hapus Foto (Fixed Path)
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

app.listen(PORT, () => console.log(`Album jalan di port ${PORT}`));