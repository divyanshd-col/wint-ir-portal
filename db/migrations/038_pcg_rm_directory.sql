-- Migration 038: PCG RM Directory for Mapping Agent Phone Numbers to Canonical RM & TL Names

CREATE TABLE IF NOT EXISTS pcg_rm_directory (
  id           BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(30) UNIQUE NOT NULL,      -- Digits only (e.g. 919187709712)
  rm_name      VARCHAR(100) NOT NULL,            -- Canonical RM Name (e.g. 'Samskrithi Rao N')
  tl_name      VARCHAR(100) NOT NULL,            -- Team Lead (e.g. 'Team Tanisha Mittal', 'Team Sravanthi')
  email        VARCHAR(255),                     -- Official Email (e.g. 'samskrithi@wintwealth.com')
  role         VARCHAR(20) DEFAULT 'rm',         -- 'rm' or 'tl'
  status       VARCHAR(20) DEFAULT 'active',     -- 'active' or 'inactive'
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcg_rm_dir_phone ON pcg_rm_directory(phone_number);
CREATE INDEX IF NOT EXISTS idx_pcg_rm_dir_rm_name ON pcg_rm_directory(rm_name);
CREATE INDEX IF NOT EXISTS idx_pcg_rm_dir_tl_name ON pcg_rm_directory(tl_name);
CREATE INDEX IF NOT EXISTS idx_pcg_rm_dir_email ON pcg_rm_directory(email);

-- Seed Initial PCG RM & TL Directory (excluding row 18)
INSERT INTO pcg_rm_directory (rm_name, email, phone_number, tl_name, role) VALUES
  ('Aboli Jawkhedkar', 'aboli.jawkhedkar@quicksell.co', '917039038853', 'Team Admin', 'rm'),
  ('Ankita Agarwal', 'ankita.a@wintwealth.com', '917001428772', 'Team Swetha', 'rm'),
  ('Antara Chakraborty', 'antara@wintwealth.com', '919187709715', 'Team Tanisha Mittal', 'rm'),
  ('Anurag Negi', 'anurag.negi@wintwealth.com', '918433264610', 'Team Sravanthi', 'rm'),
  ('Ayan Kumar Garg', 'ayan.garg@wintwealth.com', '918447524484', 'Team Saiyam Rastogi', 'rm'),
  ('Deshna Dugar', 'deshna@wintwealth.com', '919187709718', 'Team Tanisha Mittal', 'rm'),
  ('Dheeraj Bhojwani', 'dheeraj@wintwealth.com', '916366385390', 'Team Dheeraj Bhojwani', 'tl'),
  ('Diya Sharma', 'diya.sharma@wintwealth.com', '919187709725', 'Team Swetha', 'rm'),
  ('Gaurav Nautiyal', 'gaurav.nautiyal@wintwealth.com', '919187709723', 'Team Saiyam Rastogi', 'rm'),
  ('Harshita Dhona', 'harshita@wintwealth.com', '919741437057', 'Team Tanisha Mittal', 'rm'),
  ('Ishaan Kapoor', 'ishaan.kapoor@wintwealth.com', '919187709711', 'Team Dheeraj Bhojwani', 'rm'),
  ('Keshvi Suresh Thacker', 'keshvi.thacker@wintwealth.com', '919998838100', 'Team Tanisha Mittal', 'rm'),
  ('Maniyar Kriya Jignesh', 'kriya.maniyar@wintwealth.com', '919187980517', 'Team Tanisha Mittal', 'rm'),
  ('Mahek Bihani', 'mahek.bihani@wintwealth.com', '919187980521', 'Team Sravanthi', 'rm'),
  ('Mahi Agarwal', 'mahi.agarwal@wintwealth.com', '917430880385', 'Team Saiyam Rastogi', 'rm'),
  ('Nandini', 'Nandini.j@wintwealth.com', '919729123268', 'Team Saiyam Rastogi', 'rm'),
  ('Nischay Manish Jain', 'nischay.jain@wintwealth.com', '917600440691', 'Team Tanisha Mittal', 'rm'),
  ('Nishtha Veerwani', 'nishtha.veerwani@wintwealth.com', '918839218181', 'Team Swetha', 'rm'),
  ('Paritosh Ashiya', 'paritosh.ashiya@wintwealth.com', '919187709721', 'Team Dheeraj Bhojwani', 'rm'),
  ('Pranav Sharma', 'pranav.s@wintwealth.com', '919187980516', 'Team Admin', 'rm'),
  ('Ramita Kapoor', 'ramita.kapoor@wintwealth.com', '919187709727', 'Team Dheeraj Bhojwani', 'rm'),
  ('Mishra Richa Santoshkumar', 'richa.mishra@wintwealth.com', '919187980506', 'Team Swetha', 'rm'),
  ('Rukmini Mundhara', 'rukmini.mundhara@wintwealth.com', '918884448091', 'Team Saiyam Rastogi', 'rm'),
  ('Sahil Joshi', 'sahil.j@wintwealth.com', '919187980515', 'Team Saiyam Rastogi', 'rm'),
  ('Saiyam Rastogi', 'saiyam@wintwealth.com', '919036315550', 'Team Saiyam Rastogi', 'tl'),
  ('Samskrithi Rao N', 'samskrithi@wintwealth.com', '919187709712', 'Team Tanisha Mittal', 'rm'),
  ('Sargun Singh', 'sargun.singh@wintwealth.com', '917248391111', 'Team Dheeraj Bhojwani', 'rm'),
  ('Shivam Kumar Baghel', 'shivam.baghel@wintwealth.com', '917668550670', 'Team Dheeraj Bhojwani', 'rm'),
  ('Shreya Premkumar Mundada', 'shreya.mundada@wintwealth.com', '919187709716', 'Team Swetha', 'rm'),
  ('Shrey Jain', 'shrey.jain@wintwealth.com', '919187709728', 'Team Dheeraj Bhojwani', 'rm'),
  ('Shruti Sharma', 'shruti.sharma@wintwealth.com', '919187980512', 'Team Saiyam Rastogi', 'rm'),
  ('Sravanthi', 'sravanthi@wintwealth.com', '919036335553', 'Team Sravanthi', 'tl'),
  ('Sreeram', 'sreeram.v@wintwealth.com', '919187709713', 'Team Admin', 'rm'),
  ('Sujal Dadwani', 'sujal.dadwani@wintwealth.com', '919187709719', 'Team Swetha', 'rm'),
  ('Suryansh Sharma', 'suryansh.sharma@wintwealth.com', '919876990120', 'Team Swetha', 'rm'),
  ('Swetha', 'swetha@wintwealth.com', '919108891628', 'Team Swetha', 'tl'),
  ('Tanisha Mittal', 'tanisha@wintwealth.com', '919036265556', 'Team Tanisha Mittal', 'tl'),
  ('Vaishnavi N J', 'vaishnavi@wintwealth.com', '919187709724', 'Team Swetha', 'rm'),
  ('Vaishnavi Naghat', 'vaishnavi.naghat@wintwealth.com', '918839239085', 'Team Swetha', 'rm'),
  ('Vidisha Jaiswal', 'vidisha.jaiswal@wintwealth.com', '918100480744', 'Team Swetha', 'rm'),
  ('Vidyul Kapoor', 'vidyul.kapoor@wintwealth.com', '917217669460', 'Team Sravanthi', 'rm'),
  ('Vishal Kumar Yadav', 'vishalkumar@wintwealth.com', '919187709729', 'Team Saiyam Rastogi', 'rm'),
  ('Vishyata Tulsani', 'vishyata.tulsani@wintwealth.com', '919140700162', 'Team Swetha', 'rm'),
  ('Yaashvi Arora', 'yaashvi.arora@wintwealth.com', '919187709726', 'Team Dheeraj Bhojwani', 'rm')
ON CONFLICT (phone_number) DO UPDATE SET
  rm_name = EXCLUDED.rm_name,
  tl_name = EXCLUDED.tl_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  updated_at = NOW();

