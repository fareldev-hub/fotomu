const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const ImageKit = require("imagekit");
const axios = require("axios");
const crypto = require("crypto");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || config.server.port;

// Konfigurasi ImageKit
const imagekit = new ImageKit({
  publicKey: config.imagekit.publicKey,
  privateKey: config.imagekit.privateKey,
  urlEndpoint: config.imagekit.urlEndpoint
});

// Path untuk metadata
const ROOT_DIR = config.server.isVercel ? "/tmp" : __dirname;
const META_DIR = path.join(ROOT_DIR, "metadata");

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

// Konfigurasi Multer
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    ...config.upload.allowedTypes.image,
    ...config.upload.allowedTypes.video
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} tidak diizinkan`), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSize,
    files: config.upload.maxFiles
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Helper functions
const loadMetadata = () => {
  const metaPath = path.join(META_DIR, "files.json");
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }
  return { files: [], favorites: [], folders: [] };
};

const saveMetadata = (data) => {
  const metaPath = path.join(META_DIR, "files.json");
  fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
};

const uploadToImageKit = async (buffer, fileName, folder = "fotomu") => {
  try {
    const result = await imagekit.upload({
      file: buffer,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true
    });
    return result;
  } catch (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
};

const deleteFromImageKit = async (fileId) => {
  try {
    await imagekit.deleteFile(fileId);
    return true;
  } catch (error) {
    console.error("Delete error:", error);
    return false;
  }
};

// ==================== ENDPOINTS ====================

// Get all folders
app.get("/folders", (req, res) => {
  const metadata = loadMetadata();
  res.json(metadata.folders || []);
});

// Create new folder
// Create new folder
app.post("/folders", (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Nama folder diperlukan" });
  }

  const folderName = name.trim();
  const metadata = loadMetadata();
  
  // Cek duplikat
  if (metadata.folders && metadata.folders.find(f => f.name === folderName)) {
    return res.status(400).json({ error: "Folder sudah ada" }); // <-- YANG DIperbaiki
  }

  metadata.folders = metadata.folders || [];
  metadata.folders.push({
    name: folderName,
    createdAt: new Date().toISOString()
  });

  saveMetadata(metadata);
  res.json({ success: true, folder: folderName });
});


// Delete folder
app.delete("/folders/:name", (req, res) => {
  const folderName = req.params.name;
  const metadata = loadMetadata();

  // Hapus folder dari list
  metadata.folders = (metadata.folders || []).filter(f => f.name !== folderName);
  
  // Pindahkan semua file di folder ke root (update metadata lokal saja, file di ImageKit tetap)
  metadata.files = metadata.files || [];
  metadata.files.forEach(f => {
    if (f.folder === folderName) {
      f.folder = "";
    }
  });

  saveMetadata(metadata);
  res.json({ success: true });
});

// Rename folder
app.put("/folders/:name", (req, res) => {
  const oldName = req.params.name;
  const { newName } = req.body;
  
  if (!newName || newName.trim() === "") {
    return res.status(400).json({ error: "Nama baru diperlukan" });
  }

  const metadata = loadMetadata();
  const folder = metadata.folders.find(f => f.name === oldName);
  
  if (!folder) {
    return res.status(404).json({ error: "Folder tidak ditemukan" });
  }

  // Update nama folder
  folder.name = newName.trim();
  
  // Update semua file yang ada di folder tersebut
  metadata.files.forEach(f => {
    if (f.folder === oldName) {
      f.folder = newName.trim();
    }
  });

  saveMetadata(metadata);
  res.json({ success: true });
});

// Move files to folder
app.post("/move", async (req, res) => {
  const { fileIds, targetFolder } = req.body;
  
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds diperlukan" });
  }

  const metadata = loadMetadata();
  metadata.files = metadata.files || [];

  // Update folder untuk setiap file di metadata
  fileIds.forEach(fileId => {
    const file = metadata.files.find(f => f.fileId === fileId);
    if (file) {
      file.folder = targetFolder || "";
    }
  });

  saveMetadata(metadata);
  res.json({ success: true, moved: fileIds.length });
});

// Get files with folder filter
app.get("/cek-foto", async (req, res) => {
  const folder = req.query.folder || "";
  const metadata = loadMetadata();
  
  try {
    // Ambil semua file dari ImageKit
    const imageKitFiles = await imagekit.listFiles({
      path: "fotomu",
      limit: 1000
    });

    // Merge dengan metadata lokal (untuk folder dan favorites)
    const mergedFiles = imageKitFiles.map(ikFile => {
      const localData = metadata.files.find(f => f.fileId === ikFile.fileId) || {};
      
      return {
        name: ikFile.name,
        fileId: ikFile.fileId,
        url: ikFile.url,
        thumbnailUrl: ikFile.thumbnailUrl,
        size: ikFile.size,
        fileType: ikFile.fileType,
        width: ikFile.width,
        height: ikFile.height,
        createdAt: ikFile.createdAt,
        folder: localData.folder || "",
        isFavorite: metadata.favorites?.includes(ikFile.fileId) || false
      };
    });

    // Filter berdasarkan folder atau favorites
    let filteredFiles = mergedFiles;
    
    if (folder === 'favorites') {
      filteredFiles = mergedFiles.filter(f => f.isFavorite);
    } else if (folder === 'recent') {
      filteredFiles = mergedFiles.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      ).slice(0, 50);
    } else if (folder && folder !== 'all') {
      // Filter by specific folder
      filteredFiles = mergedFiles.filter(f => f.folder === folder);
    }

    // Update metadata lokal dengan data terbaru
    metadata.files = mergedFiles.map(f => ({
      fileId: f.fileId,
      folder: f.folder,
      isFavorite: f.isFavorite
    }));
    saveMetadata(metadata);

    res.json(filteredFiles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload files
app.post("/upload", upload.array("foto", config.upload.maxFiles), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Tidak ada file yang diupload" });
  }
  
  const targetFolder = req.body.folder || "";
  const uploadResults = [];
  const errors = [];
  const metadata = loadMetadata();
  metadata.files = metadata.files || [];

  for (const file of req.files) {
    try {
      const isImage = file.mimetype.startsWith('image/');
      const isVideo = file.mimetype.startsWith('video/');
      
      if (!isImage && !isVideo) {
        errors.push({ filename: file.originalname, error: "Tipe file tidak diizinkan" });
        continue;
      }
      
      // Upload ke ImageKit dengan folder path
      const ikFolder = targetFolder ? `fotomu/${targetFolder}` : "fotomu";
      const result = await uploadToImageKit(file.buffer, file.originalname, ikFolder);
      
      // Simpan ke metadata
      metadata.files.push({
        fileId: result.fileId,
        folder: targetFolder,
        isFavorite: false
      });
      
      uploadResults.push({
        originalName: file.originalname,
        fileId: result.fileId,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        fileType: result.fileType
      });
      
    } catch (error) {
      errors.push({ filename: file.originalname, error: error.message });
    }
  }

  saveMetadata(metadata);
  
  res.json({ 
    success: true, 
    uploaded: uploadResults, 
    errors: errors.length > 0 ? errors : undefined 
  });
});

// Like/Unlike
app.post("/like/:fileId", (req, res) => {
  const metadata = loadMetadata();
  const { fileId } = req.params;
  
  metadata.favorites = metadata.favorites || [];
  if (!metadata.favorites.includes(fileId)) {
    metadata.favorites.push(fileId);
  }
  
  saveMetadata(metadata);
  res.json({ success: true });
});

app.post("/unlike/:fileId", (req, res) => {
  const metadata = loadMetadata();
  const { fileId } = req.params;
  
  metadata.favorites = metadata.favorites.filter(id => id !== fileId);
  saveMetadata(metadata);
  res.json({ success: true });
});

// Delete file
app.post("/hapus", async (req, res) => {
  const { fileId } = req.body;
  
  if (!fileId) {
    return res.status(400).json({ error: "fileId diperlukan" });
  }
  
  try {
    const success = await deleteFromImageKit(fileId);
    if (success) {
      const metadata = loadMetadata();
      metadata.files = metadata.files.filter(f => f.fileId !== fileId);
      metadata.favorites = metadata.favorites.filter(id => id !== fileId);
      saveMetadata(metadata);
      
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Gagal menghapus file" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download ZIP
app.post("/download-zip", async (req, res) => {
  const { files, folder } = req.body;
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  res.attachment(`backup-${Date.now()}.zip`);
  archive.pipe(res);
  
  try {
    let filesToDownload = [];
    
    if (files && files.length > 0) {
      for (const fileId of files) {
        const fileDetails = await imagekit.getFileDetails(fileId);
        filesToDownload.push(fileDetails);
      }
    } else {
      const allFiles = await imagekit.listFiles({
        path: folder ? `fotomu/${folder}` : "fotomu",
        limit: 1000
      });
      filesToDownload = allFiles;
    }
    
    const downloadPromises = filesToDownload.map(async (file) => {
      try {
        const response = await axios.get(file.url, { 
          responseType: 'stream',
          timeout: 30000
        });
        archive.append(response.data, { name: file.name });
      } catch (error) {
        console.error(`Gagal download ${file.name}:`, error.message);
      }
    });
    
    await Promise.all(downloadPromises);
    archive.finalize();
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: "File terlalu besar" });
    }
  }
  res.status(500).json({ error: error.message });
});

// Start server
if (!config.server.isProduction) {
  app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
}

module.exports = app;