import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("reconcile an already-applied inventory migration without modifying existing rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);");
    const files = readdirSync("migrations").filter(name => name.endsWith(".sql")).sort();
    for (const file of files.filter(name => name < "0013")) {
      db.exec(readFileSync(`migrations/${file}`, "utf8"));
      if (file < "0012") db.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(file);
    }
    db.prepare("INSERT INTO inventory_cards(id,product,card,cardHash,tradeNo,createdAt) VALUES(?,?,?,?,?,?)").run("sample", "muse", "test-only", "test-hash", "test-order", 1);
    assert.throws(() => db.exec(readFileSync("migrations/0012_inventory_delivery_history.sql", "utf8")));
    const unique = db.prepare("SELECT count(*) AS n FROM pragma_index_list('inventory_cards') AS i WHERE i.[unique]=1 AND i.origin='u' AND (SELECT group_concat(name) FROM pragma_index_info(i.name)) IN ('cardHash','orderId')").get();
    assert.equal(unique.n, 2);
    for (const [table, field, target] of [["inventory_cards","orderId","orders"],["delivery_history","orderId","orders"],["supplier_fulfillment","inventoryId","inventory_cards"]]) {
      assert.ok(db.prepare(`SELECT 1 FROM pragma_foreign_key_list(?) WHERE [from]=? AND [table]=? AND [to]='id'`).get(table,field,target));
    }
    db.prepare("INSERT INTO d1_migrations(name) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name=?)").run("0012_inventory_delivery_history.sql","0012_inventory_delivery_history.sql");
    for (const file of files.filter(name => name >= "0013")) { db.exec(readFileSync(`migrations/${file}`, "utf8")); db.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(file); }
    assert.equal(db.prepare("SELECT card FROM inventory_cards WHERE id='sample'").get().card, "test-only");
    assert.equal(db.prepare("SELECT count(*) AS n FROM d1_migrations WHERE name='0012_inventory_delivery_history.sql'").get().n, 1);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commission_controls'").get());
  } finally { db.close(); }
});
