# How to Create a Week Record in Your Database

You need to create a Week record before inserting games. Here are your options:

## Option 1: Using MySQL Command Line

1. **Open Terminal/Command Prompt**

2. **Connect to your database:**
   ```bash
   mysql -h etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com -P 3306 -u x8kicio7cckzkrin -p c86v9vfflniegysr
   ```
   (It will prompt for password: `jv3nfhqf64jj44m4`)

3. **Run the SQL:**
   ```sql
   INSERT INTO Weeks (week_number, season_year, start_date, end_date, is_completed)
   VALUES (10, 2024, '2024-11-01', '2024-11-03', FALSE);
   ```

4. **Get the week_id:**
   ```sql
   SELECT * FROM Weeks ORDER BY id DESC LIMIT 1;
   ```
   Note the `id` value - that's your week_id!

## Option 2: Using MySQL Workbench (GUI Tool)

1. **Download MySQL Workbench** (if you don't have it): https://dev.mysql.com/downloads/workbench/

2. **Create a new connection:**
   - Host: `etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com`
   - Port: `3306`
   - Username: `x8kicio7cckzkrin`
   - Password: `jv3nfhqf64jj44m4`
   - Database: `c86v9vfflniegysr`

3. **Connect and run the SQL** from `create_week.sql`

## Option 3: Online Database Tool

Use an online MySQL client like:
- **Adminer**: https://www.adminer.org/ (run locally or use online version)
- **phpMyAdmin**: If you have web hosting
- **HeidiSQL**: Windows tool

## Option 4: Heroku Database Tool

If your Heroku JawsDB add-on has a web console, you can run SQL directly there.

---

## After Creating the Week

Once you have the `week_id`, you can:
1. Run the Python script: `python espn_api_extractor.py`
2. Choose "Auto-insert to database"
3. Enter the week_id when prompted

Or manually use the SQL INSERT statements the script generates.

