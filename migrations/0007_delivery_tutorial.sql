CREATE TABLE tutorials (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 blocks TEXT NOT NULL,
 updatedAt INTEGER NOT NULL
);
CREATE TABLE tutorial_images (
 id TEXT PRIMARY KEY,
 mime TEXT NOT NULL,
 data TEXT NOT NULL,
 createdAt INTEGER NOT NULL
);
CREATE TABLE delivery_emails (
 orderId TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 sentAt INTEGER,
 createdAt INTEGER NOT NULL
);
