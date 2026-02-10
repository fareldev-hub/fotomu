const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const FOTO_DIR = path.join(__dirname, "fotomu");

if (!fs.existsSync(FOTO_DIR)) {
  fs.mkdirSync(FOTO_DIR);
}

// config multer (banyak foto)
const storage = multer.diskStorage({
  destination: FOTO_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.use(express.static("public"));
app.use("/fotomu", express.static("fotomu"));
app.use(express.urlencoded({ extended: true }));

// ambil semua foto
app.get("/cek-foto", (req, res) => {
  const files = fs.readdirSync(FOTO_DIR);
  res.json(files);
});

// upload banyak foto
app.post("/upload", upload.array("foto", 10), (req, res) => {
  res.redirect("/");
});

// hapus satu foto
app.post("/hapus/:nama", (req, res) => {
  const filePath = path.join(FOTO_DIR, req.params.nama);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.redirect("/");
});

// hapus semua foto
app.post("/hapus-semua", (req, res) => {
  fs.readdirSync(FOTO_DIR).forEach(file => {
    fs.unlinkSync(path.join(FOTO_DIR, file));
  });
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log("Fotomu jalan di port " + PORT);
});
