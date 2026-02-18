module.exports = {
  imagekit: {
    publicKey: "public_+DXaKVwGF/DYGD0DZs0ec7w3/FM=",
    privateKey: "private_/SK2n9tHNeXedmGYFIFihWn6Yfs=",
    urlEndpoint: "https://ik.imagekit.io/FarelServer"
  },
  
  server: {
    port: 3000,
    isProduction: process.env.NODE_ENV === 'production',
    isVercel: process.env.VERCEL === '1' || process.env.VERCEL === 'true'
  },
  
  upload: {
    maxFileSize: 100 * 1024 * 1024,
    maxFiles: 20,
    allowedTypes: {
      image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/avif'],
      video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-flv', 'video/mpeg', 'video/avi', 'video/mov']
    }
  }
};