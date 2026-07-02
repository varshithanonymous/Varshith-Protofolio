import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  try {
    // Create the gallery table
    await sql`
      CREATE TABLE IF NOT EXISTS gallery (
        id SERIAL PRIMARY KEY,
        url VARCHAR(255) NOT NULL,
        label VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create the settings table (key-value store for links and resume)
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Insert default settings if they don't exist
    const defaultSettings = [
      ['github', 'https://github.com/varshithanonymous'],
      ['linkedin', 'https://www.linkedin.com/in/varshithrallabandi'],
      ['whatsapp', '919502901416'],
      ['instagram', 'https://www.instagram.com/varshi_th__'],
      ['email', 'varshithrallabandi31@gmail.com'],
      ['phone', '+91 9502901416'],
      ['resume', 'https://drive.google.com/file/d/1_qFPc1AvQYmOMyYjRYGZ9JDvEVhzSaQL/view?usp=sharing']
    ];

    for (const [key, value] of defaultSettings) {
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO NOTHING;
      `;
    }

    res.status(200).json({ success: true, message: 'Database setup successfully' });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
