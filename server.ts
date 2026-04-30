import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Serve uploads directory directly
  app.use('/uploads', express.static(uploadsDir));

  // API routes FIRST
  app.post("/api/upload", async (req, res) => {
    try {
      const { imageBase64, imageUrl, filename } = req.body;
      
      let data = '';
      let extension = 'png';

      if (imageBase64) {
        const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        data = imageBase64;
        
        if (matches && matches.length === 3) {
          data = matches[2];
          const mime = matches[1];
          if (mime === 'image/jpeg') extension = 'jpg';
          else if (mime === 'image/webp') extension = 'webp';
        }
      } else if (imageUrl) {
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error("Failed to fetch image");
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer).toString('base64');
          
          const contentType = response.headers.get('content-type');
          if (contentType === 'image/jpeg') extension = 'jpg';
          else if (contentType === 'image/webp') extension = 'webp';
          else if (contentType === 'image/gif') extension = 'gif';
        } catch (e) {
          console.error("Error downloading image from URL:", e);
          return res.status(400).json({ error: "Failed to download image from URL" });
        }
      } else {
        return res.status(400).json({ error: "No image provided" });
      }

      const safeFilename = filename ? filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() : `img_${Date.now()}`;
      const finalFilename = `${safeFilename}_${Date.now()}.${extension}`;
      const filePath = path.join(uploadsDir, finalFilename);

      fs.writeFileSync(filePath, data, 'base64');

      // Return the URL (absolute URL based on request host)
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers.host;
      const url = `${protocol}://${host}/uploads/${finalFilename}`;
      
      res.json({ url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to save image" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
