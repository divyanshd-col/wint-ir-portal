import fs from 'fs';
import { Pool } from 'pg';

const envPath = './.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    process.env[key] = val;
  }
});

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: false
});

const WEIGHTS = {
  Technical:    0.20,
  AllQuestions: 0.10,
  Expectation:  0.10,
  Contextual:   0.10,
  FollowUp:     0.10,
  Sentences:    0.10,
  Process:      0.05,
  Opening:      0.05,
  Call:         0.05,
  Grammar:      0.05,
  Empathy:      0.10,
  Tags:         0.05, // include historical Tags parameter for verification
};

const CALL_WEIGHTS = {
  CallOpening:     0.05,
  CallClosing:     0.05,
  TechnicalLegal:  0.15,
  AllQuestions:    0.10,
  Expectation:     0.10,
  Process:         0.05,
  Grammar:         0.10,
  Fillers:         0.10,
  EnergyTone:      0.10,
  ActiveListening: 0.10,
  Simplifying:     0.10,
};

function calculateIQS(scores) {
  let total = 0, possible = 0;
  for (const [param, weight] of Object.entries(WEIGHTS)) {
    const score = scores[param] ?? 'Yes';
    if (score !== 'NA') {
      possible += weight;
      if (score === 'Yes') {
        total += weight;
      }
    }
  }
  return possible > 0 ? Math.round((total / possible) * 100) : 100;
}

function calculateCallIQS(scores) {
  let total = 0, possible = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'NA';
    if (score !== 'NA') {
      possible += weight;
      if (score === 'Yes') {
        total += weight;
      }
    }
  }
  return possible > 0 ? Math.round((total / possible) * 100) : 100;
}

async function main() {
  const iqsRows = await pool.query('SELECT * FROM iqs_scores WHERE chat_id = $1', ['80527']);
  const iqs = iqsRows.rows[0];

  console.log('--- CHAT IQS CALCULATOR TRACE ---');
  const chatScores = {};
  for (const [k, v] of Object.entries(iqs.parameters)) {
    chatScores[k] = v.score === true ? 'Yes' : v.score === false ? 'No' : 'NA';
  }
  console.log('Chat scores reconstructed:', chatScores);
  
  // Calculate with Tags
  let possibleChat = 0, passedChat = 0;
  for (const [param, weight] of Object.entries(WEIGHTS)) {
    const score = chatScores[param] ?? 'Yes';
    if (score !== 'NA') {
      possibleChat += weight;
      if (score === 'Yes') {
        passedChat += weight;
      }
      console.log(`- ${param}: score=${score}, weight=${weight}, running_passed=${passedChat.toFixed(2)}, running_possible=${possibleChat.toFixed(2)}`);
    } else {
      console.log(`- ${param}: score=NA, weight=${weight} (EXCLUDED)`);
    }
  }
  const reChat = possibleChat > 0 ? Math.round((passedChat / possibleChat) * 100) : 100;
  console.log(`Final Chat IQS re-calculated: (${passedChat.toFixed(2)} / ${possibleChat.toFixed(2)}) * 100 = ${reChat}% (DB value: ${iqs.iqs_score}%)`);

  console.log('\n--- CALL IQS CALCULATOR TRACE ---');
  const callScores = {};
  for (const [k, v] of Object.entries(iqs.call_parameters)) {
    const scoreVal = v.score;
    // Wait, in database representation, is score stored as string or boolean?
    // Let's check both cases
    if (scoreVal === true || scoreVal === 'Yes') {
      callScores[k] = 'Yes';
    } else if (scoreVal === false || scoreVal === 'No') {
      callScores[k] = 'No';
    } else {
      callScores[k] = 'NA';
    }
  }
  console.log('Call scores reconstructed:', callScores);

  let possibleCall = 0, passedCall = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = callScores[param] ?? 'NA';
    if (score !== 'NA') {
      possibleCall += weight;
      if (score === 'Yes') {
        passedCall += weight;
      }
      console.log(`- ${param}: score=${score}, weight=${weight}, running_passed=${passedCall.toFixed(2)}, running_possible=${possibleCall.toFixed(2)}`);
    } else {
      console.log(`- ${param}: score=NA, weight=${weight} (EXCLUDED)`);
    }
  }
  const reCall = possibleCall > 0 ? Math.round((passedCall / possibleCall) * 100) : 100;
  console.log(`Final Call IQS re-calculated: (${passedCall.toFixed(2)} / ${possibleCall.toFixed(2)}) * 100 = ${reCall}% (DB value: ${iqs.call_iqs_score}%)`);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
