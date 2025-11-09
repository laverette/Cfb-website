-- Add role column to Users table if it doesn't exist
-- Note: MySQL doesn't support IF NOT EXISTS in ALTER TABLE, so check first or ignore error
ALTER TABLE Users 
ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER bio;

-- Create Settings table for storing current week and other admin settings
-- Note: 'key' is a reserved word in MySQL, so we use backticks
CREATE TABLE IF NOT EXISTS Settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (`key`)
);

