-- Add role column to Users table
-- If the column already exists, you'll get an error - that's okay, just ignore it
ALTER TABLE Users 
ADD COLUMN role VARCHAR(20) DEFAULT 'user' AFTER bio;

-- Create Settings table for storing current week and other admin settings
CREATE TABLE IF NOT EXISTS Settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (`key`)
);

-- Note: 'key' is a reserved word in MySQL, so we use backticks around it
-- If you get an error about the role column already existing, that's fine - it means it's already there

