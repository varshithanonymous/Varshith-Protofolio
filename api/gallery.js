import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const galleryStorePath = path.join(os.tmpdir(), 'portfolio-gallery-store.json');
const uploadDir = path.join(os.tmpdir(), 'portfolio-gallery-uploads');

// Ensure the function can accept larger payloads (max limit for Serverless Functions is 4.5MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

async function ensureLocalStore() {
  await fs.mkdir(uploadDir, { recursive: true });

  try {
    await fs.access(galleryStorePath);
  } catch {
    await fs.writeFile(galleryStorePath, '[]', 'utf8');
  }
}

async function readLocalGallery() {
  await ensureLocalStore();
  const raw = await fs.readFile(galleryStorePath, 'utf8');
  return JSON.parse(raw);
}

async function writeLocalGallery(items) {
  await ensureLocalStore();
  await fs.writeFile(galleryStorePath, JSON.stringify(items, null, 2), 'utf8');
}

function getImageMimeType(filename) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return `image/${ext || 'png'}`;
}

async function normalizeGalleryItem(item) {
  if (item?.url?.startsWith('/images/uploads/')) {
    const fileName = path.basename(item.url);
    const filePath = path.join(uploadDir, fileName);
    try {
      const buffer = await fs.readFile(filePath);
      const mime = getImageMimeType(fileName);
      return { ...item, url: `data:${mime};base64,${buffer.toString('base64')}` };
    } catch (error) {
      console.warn('Failed to normalize local gallery image:', error.message);
      return item;
    }
  }
  return item;
}

function sanitizeFilename(filename) {
  const ext = path.extname(filename || 'image.png');
  const base = path.basename(filename || 'image', ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'image';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${ext}`;
}

async function saveImageLocally(buffer, filename) {
  await ensureLocalStore();
  const safeName = sanitizeFilename(filename);
  const filePath = path.join(uploadDir, safeName);
  await fs.writeFile(filePath, buffer);
  return { url: `/images/uploads/${safeName}` };
}

async function saveGalleryEntryLocally({ url, label, cat }) {
  const items = await readLocalGallery();
  const record = {
    id: Date.now(),
    url,
    label,
    category: cat,
    created_at: new Date().toISOString(),
  };

  items.unshift(record);
  await writeLocalGallery(items);
  return record;
}

async function deleteGalleryEntryLocally(id) {
  const items = await readLocalGallery();
  const target = items.find((item) => String(item.id) === String(id));

  if (!target) {
    return false;
  }

  if (target.url && target.url.startsWith('/images/uploads/')) {
    const fileName = path.basename(target.url);
    const filePath = path.join(uploadDir, fileName);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn('Failed to delete local image file:', error.message);
    }
  }

  const updated = items.filter((item) => String(item.id) !== String(id));
  await writeLocalGallery(updated);
  return true;
}

export default async function handler(req, res) {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  const sql = connectionString ? neon(connectionString) : null;

  if (req.method === 'GET') {
    try {
      if (sql) {
        try {
          const rows = await sql`SELECT * FROM gallery ORDER BY created_at DESC;`;
          return res.status(200).json({ success: true, gallery: rows, storage: 'database' });
        } catch (dbError) {
          console.warn('Database lookup failed, using local gallery store:', dbError.message);
        }
      }

      const rows = await readLocalGallery();
      const normalized = await Promise.all(rows.map(normalizeGalleryItem));
      return res.status(200).json({ success: true, gallery: normalized, storage: 'local' });
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
      return res.status(500).json({ success: false, error: 'Gallery fetch error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { imageBase64, filename, label, cat } = req.body;

      if (!imageBase64 || !filename || !label || !cat) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      let uploadedUrl = imageBase64;
      let imageRecord = null;
      let storageMode = 'local';

      try {
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          const blob = await put(filename, buffer, {
            access: 'public',
            addRandomSuffix: true,
          });
          uploadedUrl = blob.url;
          storageMode = 'blob';
        } else {
          throw new Error('Blob token not configured');
        }
      } catch (blobError) {
        console.warn('Blob upload unavailable, using base64 data URL for local images:', blobError.message);
        uploadedUrl = imageBase64;
        storageMode = 'local';
      }

      if (sql) {
        try {
          const rows = await sql`
            INSERT INTO gallery (url, label, category)
            VALUES (${uploadedUrl}, ${label}, ${cat})
            RETURNING *;
          `;
          imageRecord = rows[0];
          storageMode = 'database';
        } catch (dbError) {
          console.warn('Database insert failed, storing image locally:', dbError.message);
          imageRecord = await saveGalleryEntryLocally({ url: uploadedUrl, label, cat });
          storageMode = 'local';
        }
      } else {
        imageRecord = await saveGalleryEntryLocally({ url: uploadedUrl, label, cat });
      }

      return res.status(200).json({ success: true, image: imageRecord, storage: storageMode });
    } catch (error) {
      console.error('Failed to upload image:', error);
      return res.status(500).json({ success: false, error: 'Upload failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id, url } = req.body;

      if (!id) {
        return res.status(400).json({ success: false, error: 'Missing id' });
      }

      if (url && url.startsWith('http')) {
        try {
          await del(url);
        } catch (blobError) {
          console.warn('Failed to delete blob (it may have already been deleted):', blobError.message);
        }
      }

      if (sql) {
        try {
          await sql`DELETE FROM gallery WHERE id = ${id}`;
        } catch (dbError) {
          console.warn('Database delete failed, removing local gallery entry:', dbError.message);
          await deleteGalleryEntryLocally(id);
        }
      } else {
        await deleteGalleryEntryLocally(id);
      }

      return res.status(200).json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
      console.error('Failed to delete image:', error);
      return res.status(500).json({ success: false, error: 'Delete failed' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
