CREATE TABLE delivery_files (
 id TEXT PRIMARY KEY,
 orderId TEXT NOT NULL,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 uploadedBytes INTEGER NOT NULL DEFAULT 0,
 createdAt INTEGER NOT NULL,
 FOREIGN KEY(orderId) REFERENCES orders(id)
);
CREATE INDEX delivery_files_order ON delivery_files(orderId);
CREATE TABLE delivery_file_chunks (
 fileId TEXT NOT NULL,
 part INTEGER NOT NULL,
 data TEXT NOT NULL,
 PRIMARY KEY(fileId, part),
 FOREIGN KEY(fileId) REFERENCES delivery_files(id) ON DELETE CASCADE
);
ALTER TABLE delivery_emails ADD COLUMN sendCount INTEGER NOT NULL DEFAULT 0;
