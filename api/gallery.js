import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';

// Ensure the function can accept larger payloads (max limit for Serverless Functions is 4.5MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

export default async function handler(req, res) {
  const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM gallery ORDER BY created_at DESC;`;
      return res.status(200).json({ success: true, gallery: rows });
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { imageBase64, filename, label, cat } = req.body;

      if (!imageBase64 || !filename || !label || !cat) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      // Convert Base64 back to a Buffer
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload the buffer to Vercel Blob
      const blob = await put(filename, buffer, {
        access: 'public',
        addRandomSuffix: true
      });

      // Insert the details into Postgres
      const rows = await sql`
        INSERT INTO gallery (url, label, category)
        VALUES (${blob.url}, ${label}, ${cat})
        RETURNING *;
      `;

      return res.status(200).json({ success: true, image: rows[0] });
    } catch (error) {
      console.error('Failed to upload image:', error);
      return res.status(500).json({ success: false, error: 'Upload or database error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id, url } = req.body;

      if (!id) {
        return res.status(400).json({ success: false, error: 'Missing id' });
      }

      // Delete from Vercel Blob if a URL is provided
      if (url) {
        try {
          await del(url);
        } catch (blobError) {
          console.error('Failed to delete blob (it may have already been deleted):', blobError);
        }
      }

      // Delete from Postgres
      await sql`DELETE FROM gallery WHERE id = ${id}`;

      return res.status(200).json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
      console.error('Failed to delete image:', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
