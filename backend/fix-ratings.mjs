import pg from 'pg';

const client = new pg.Client({
  host: 'localhost',
  port: 5432,
  database: 'yala_nsafr',
  user: 'yala_user',
  password: 'yala_pass',
});

await client.connect();

const { rowCount: r1 } = await client.query(
  `UPDATE ratings SET is_revealed = true WHERE is_revealed = false`
);
console.log(`Revealed ${r1} rating(s)`);

const { rowCount: r2 } = await client.query(`
  UPDATE users u
  SET
    rating_average = COALESCE((
      SELECT ROUND(AVG(r.score)::numeric, 2)
      FROM ratings r WHERE r.ratee_id = u.id AND r.is_revealed = true
    ), 0),
    rating_count = (
      SELECT COUNT(*) FROM ratings r WHERE r.ratee_id = u.id AND r.is_revealed = true
    )
  WHERE EXISTS (
    SELECT 1 FROM ratings r WHERE r.ratee_id = u.id AND r.is_revealed = true
  )
`);
console.log(`Recalculated averages for ${r2} user(s)`);

await client.end();
console.log('Done!');
