// Disposable PostgreSQL benchmark. Does not read office configuration or DATABASE_URL.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=await PGlite.create();
try {
 await db.exec(await readFile('schema.sql','utf8'));
 await db.exec(`INSERT INTO stores(id,name,code) VALUES(1,'Fixture','TEST');
 INSERT INTO products(id,name,department) SELECT n,CASE WHEN n=3000 THEN ' Fixture 1 ' ELSE 'Fixture '||n END,'Fixture' FROM generate_series(1,3000) n;
 INSERT INTO store_products(id,store_id,product_id,store_product_code) SELECT n,1,n,n::text FROM generate_series(1,3000) n;
 INSERT INTO book_stock(store_product_id,book_stock_date,book_stock_qty,imported_at)
 SELECT n,'2026-10-14',CASE WHEN n%3=0 THEN -1 ELSE 2 END,'2026-10-14'::timestamp+snapshot*interval '1 hour'
 FROM generate_series(1,3000) n CROSS JOIN generate_series(1,5) snapshot;
 ANALYZE products; ANALYZE store_products; ANALYZE book_stock;`);
 const cases=[{
  name:'Duplicate product detection',
  before:`SELECT sp.id FROM store_products sp JOIN products p ON p.id=sp.product_id
   WHERE EXISTS(SELECT 1 FROM products other WHERE other.is_active AND other.id<>p.id
   AND lower(regexp_replace(trim(other.name),'\\s+',' ','g'))=lower(regexp_replace(trim(p.name),'\\s+',' ','g'))) ORDER BY sp.id`,
  after:`WITH normalized AS MATERIALIZED(SELECT id,lower(regexp_replace(trim(name),'\\s+',' ','g')) AS name FROM products WHERE is_active),
   duplicates AS(SELECT name FROM normalized GROUP BY name HAVING count(*)>1)
   SELECT sp.id FROM store_products sp JOIN normalized p ON p.id=sp.product_id JOIN duplicates d ON d.name=p.name ORDER BY sp.id`,
  expected:2,
 },{
  name:'Latest stock snapshot findings',
  before:`SELECT b.store_product_id FROM store_products sp JOIN book_stock b ON b.store_product_id=sp.id
   WHERE b.book_stock_qty<0 AND b.imported_at=(SELECT max(b2.imported_at) FROM book_stock b2
   JOIN store_products sp2 ON sp2.id=b2.store_product_id WHERE sp2.store_id=sp.store_id) ORDER BY b.store_product_id`,
  after:`WITH snapshots AS MATERIALIZED(SELECT sp.store_id,max(b.imported_at) AS imported_at
   FROM book_stock b JOIN store_products sp ON sp.id=b.store_product_id GROUP BY sp.store_id)
   SELECT b.store_product_id FROM store_products sp JOIN book_stock b ON b.store_product_id=sp.id
   JOIN snapshots s ON s.store_id=sp.store_id AND s.imported_at=b.imported_at WHERE b.book_stock_qty<0 ORDER BY b.store_product_id`,
  expected:1000,
 }];
 for(const fixture of cases){
  let start=performance.now();const before=await db.query(fixture.before);const beforeMs=performance.now()-start;
  start=performance.now();const after=await db.query(fixture.after);const afterMs=performance.now()-start;
  assert.equal(after.rows.length,fixture.expected);assert.deepEqual(after.rows,before.rows);
  console.log(JSON.stringify({check:fixture.name,products:3000,stockRows:15000,beforeMs:Math.round(beforeMs),afterMs:Math.round(afterMs),speedup:Number((beforeMs/afterMs).toFixed(1)),identicalResults:true}));
 }
}finally{await db.close();}
