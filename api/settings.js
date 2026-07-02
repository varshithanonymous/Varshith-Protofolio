import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const { rows } = await sql`SELECT * FROM settings;`;
      
      // Convert rows array [{key: 'github', value: 'url'}, ...] into an object { github: 'url', ... }
      const settings = rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});

      return res.status(200).json({ success: true, settings });
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
  }

  if (req.method === 'POST') {
    try {
      // Expecting a payload like { key: 'github', value: 'https://...' }
      const { key, value } = req.body;

      if (!key || value === undefined) {
        return res.status(400).json({ success: false, error: 'Missing key or value' });
      }

      // Upsert the setting
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
      `;

      return res.status(200).json({ success: true, message: 'Setting updated successfully' });
    } catch (error) {
      console.error('Failed to update setting:', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
