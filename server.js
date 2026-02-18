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

const imagekit = new ImageKit({
  publicKey: config.imagekit.publicKey,
  privateKey: config.imagekit.privateKey,
  urlEndpoint: config.imagekit.urlEndpoint
});

const ROOT_DIR = config.server.isVercel ? "/tmp" : __dirname;
const META_DIR = path.join(ROOT_DIR, "metadata");

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

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

// Helper: Deteksi tipe file dari mimetype
const getFileType = (mimetype) => {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  return 'file';
};

const uploadToImageKit = async (buffer, fileName, folder = "fotomu", mimetype) => {
  try {
    // Tentukan tipe file untuk ImageKit
    const fileType = getFileType(mimetype);
    
    const uploadOptions = {
      file: buffer,
      fileName: fileName,
      folder: folder,
      useUniqueFileName: true
    };
    
    // Jika video, tambahkan parameter khusus
    if (fileType === 'video') {
      uploadOptions.isPrivateFile = false;
      // Force ImageKit untuk mengenali sebagai video
      uploadOptions.extensions = [
        {
          name: "google-auto-tagging",
          maxTags: 5,
          minConfidence: 95
        }
      ];
    }
    
    const result = await imagekit.upload(uploadOptions);
    
    // Override fileType jika ImageKit salah deteksi
    if (fileType === 'video' && result.fileType !== 'video') {
      result.fileType = 'video';
    }
    
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
    console.error("Delete error:", error.message || error);
    return false;
  }
};

app.get("/folders", (req, res) => {
  const metadata = loadMetadata();
  res.json(metadata.folders || []);
});

app.post("/folders", (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Nama folder diperlukan" });
  }

  const folderName = name.trim();
  const metadata = loadMetadata();
  
  if (metadata.folders && metadata.folders.find(f => f.name === folderName)) {
    return res.status(400).json({ error: "Folder sudah ada" });
  }

  metadata.folders = metadata.folders || [];
  metadata.folders.push({
    name: folderName,
    createdAt: new Date().toISOString()
  });

  saveMetadata(metadata);
  res.json({ success: true, folder: folderName });
});

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

  if (metadata.folders.find(f => f.name === newName.trim() && f.name !== oldName)) {
    return res.status(400).json({ error: "Nama folder sudah digunakan" });
  }

  folder.name = newName.trim();
  
  metadata.files.forEach(f => {
    if (f.folder === oldName) {
      f.folder = newName.trim();
    }
  });

  saveMetadata(metadata);
  res.json({ success: true });
});

app.delete("/folders/:name", (req, res) => {
  const folderName = req.params.name;
  const metadata = loadMetadata();

  metadata.folders = (metadata.folders || []).filter(f => f.name !== folderName);
  
  metadata.files = metadata.files || [];
  metadata.files.forEach(f => {
    if (f.folder === folderName) {
      f.folder = "";
    }
  });

  saveMetadata(metadata);
  res.json({ success: true });
});

app.post("/move", async (req, res) => {
  const { fileIds, targetFolder } = req.body;
  
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds diperlukan" });
  }

  const metadata = loadMetadata();
  metadata.files = metadata.files || [];

  fileIds.forEach(fileId => {
    const file = metadata.files.find(f => f.fileId === fileId);
    if (file) {
      file.folder = targetFolder || "";
    } else {
      metadata.files.push({
        fileId: fileId,
        folder: targetFolder || "",
        isFavorite: false
      });
    }
  });

  saveMetadata(metadata);
  res.json({ success: true, moved: fileIds.length });
});

app.get("/cek-foto", async (req, res) => {
  const folder = req.query.folder || "";
  const metadata = loadMetadata();
  
  try {
    const imageKitFiles = await imagekit.listFiles({
      path: "fotomu",
      limit: 1000
    });

    const mergedFiles = imageKitFiles.map(ikFile => {
      const localData = metadata.files.find(f => f.fileId === ikFile.fileId) || {};
      
      // FIX: Deteksi ulang fileType berdasarkan extension jika ImageKit salah
      let detectedFileType = ikFile.fileType;
      const ext = path.extname(ikFile.name).toLowerCase();
      const videoExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv', '.m4v', '.3gp'];
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];
      
      if (videoExts.includes(ext) && detectedFileType !== 'video') {
        detectedFileType = 'video';
      } else if (imageExts.includes(ext) && detectedFileType !== 'image') {
        detectedFileType = 'image';
      }
      
      return {
        name: ikFile.name,
        fileId: ikFile.fileId,
        url: ikFile.url,
        thumbnailUrl: ikFile.thumbnailUrl,
        size: ikFile.size,
        fileType: detectedFileType, // Gunakan hasil deteksi yang sudah diperbaiki
        width: ikFile.width,
        height: ikFile.height,
        createdAt: ikFile.createdAt,
        folder: localData.folder || "",
        isFavorite: metadata.favorites?.includes(ikFile.fileId) || false
      };
    });

    let filteredFiles = mergedFiles;
    
    if (folder === 'favorites') {
      filteredFiles = mergedFiles.filter(f => f.isFavorite);
    } else if (folder === 'recent') {
      filteredFiles = mergedFiles.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      ).slice(0, 50);
    } else if (folder && folder !== 'all') {
      filteredFiles = mergedFiles.filter(f => f.folder === folder);
    }

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

app.post("/upload", upload.array("foto", config.upload.maxFiles), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Tidak ada file yang diupload" });
  }
  
  const targetFolder = req.body.folder || "";
  const uploadResults = [];
  const errors = [];
  const metadata = loadMetadata();
  metadata.files = metadata.files || [];

  const generateId = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  for (const file of req.files) {
    try {
      const isImage = file.mimetype.startsWith('image/');
      const isVideo = file.mimetype.startsWith('video/');
      
      if (!isImage && !isVideo) {
        errors.push({ filename: file.originalname, error: "Tipe file tidak diizinkan" });
        continue;
      }
      
      const ext = path.extname(file.originalname);
      const id4digit = generateId();
      const newFileName = `fotomu${id4digit}${ext}`;
      
      const ikFolder = targetFolder ? `fotomu/${targetFolder}` : "fotomu";
      
      // FIX: Kirim mimetype ke fungsi upload
      const result = await uploadToImageKit(file.buffer, newFileName, ikFolder, file.mimetype);
      
      // FIX: Pastikan fileType benar di response
      const correctFileType = isVideo ? 'video' : 'image';
      
      metadata.files.push({
        fileId: result.fileId,
        folder: targetFolder,
        isFavorite: false,
        fileType: correctFileType // Simpan tipe file di metadata
      });
      
      uploadResults.push({
        originalName: file.originalname,
        newName: newFileName,
        fileId: result.fileId,
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        fileType: correctFileType, // FIX: Gunakan tipe yang sudah diverifikasi
        size: result.size
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

app.post("/hapus", async (req, res) => {
  const { fileId } = req.body;
  
  if (!fileId) {
    return res.status(400).json({ error: "fileId diperlukan" });
  }
  
  try {
    const metadata = loadMetadata();
    metadata.files = metadata.files.filter(f => f.fileId !== fileId);
    metadata.favorites = metadata.favorites.filter(id => id !== fileId);
    saveMetadata(metadata);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    let retries = 3;
    let success = false;
    
    while (retries > 0 && !success) {
      try {
        success = await deleteFromImageKit(fileId);
        if (success) break;
      } catch (e) {
        console.log(`Retry delete... ${retries} attempts left`);
      }
      retries--;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    res.json({ success: true, deletedFromCloud: success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/download-zip", async (req, res) => {
  const { files, folder } = req.body;
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  res.attachment(`backup-${Date.now()}.zip`);
  archive.pipe(res);
  
  try {
    let filesToDownload = [];
    
    if (files && files.length > 0) {
      for (const fileId of files) {
        try {
          const fileDetails = await imagekit.getFileDetails(fileId);
          filesToDownload.push(fileDetails);
        } catch (e) {
          console.error("Skip file not found:", fileId);
        }
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

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: "File terlalu besar" });
    }
  }
  res.status(500).json({ error: error.message });
});

if (!config.server.isProduction) {
  app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
}

module.exports = app;