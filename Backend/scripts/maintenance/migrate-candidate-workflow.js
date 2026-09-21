'use strict';

const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { Candidate } = require('../../src/modules/business/models');
const { CRM_STAGE_RANK } = require('../../src/modules/business/rules');

const stageMap = Object.freeze({ NEW: 'NEW_LEAD', CONTACTED: 'CALLED', INTERVIEWED: 'INTERVIEW_SCHEDULED', DID_NOT_JOIN: 'REJECTED' });
const languages = new Map(['ENGLISH', 'KANNADA', 'HINDI', 'TAMIL', 'TELUGU', 'MALAYALAM', 'MARATHI', 'BENGALI', 'GUJARATI', 'URDU'].map((value) => [value, value]));

function migrateLanguage(language) {
  const values = String(language || '').split(/[,/]/).map((value) => value.trim()).filter(Boolean);
  const known = []; const other = [];
  for (const value of values) {
    const normalized = value.toUpperCase().replace(/\s+/g, '_');
    if (languages.has(normalized)) known.push(normalized); else other.push(value);
  }
  if (other.length) known.push('OTHER');
  return { languages: [...new Set(known)], otherLanguage: other.join(', ') || null };
}

function migrationPatch(candidate) {
  const stage = stageMap[candidate.stage] || candidate.stage;
  const converted = migrateLanguage(candidate.language);
  const historicalRanks = (candidate.stageHistory || []).map((item) => CRM_STAGE_RANK[stageMap[item.toStage] || item.toStage]).filter(Number.isInteger);
  const progressionRank = Math.max(CRM_STAGE_RANK[stage] ?? 0, Number(candidate.progressionRank) || 0, ...historicalRanks);
  return {
    stage, progressionRank,
    candidateType: candidate.candidateType || 'NON_IT',
    languages: candidate.languages?.length ? candidate.languages : converted.languages.length ? converted.languages : ['OTHER'],
    otherLanguage: candidate.otherLanguage || converted.otherLanguage || (candidate.languages?.length ? null : 'Not specified'),
  };
}

async function run() {
  await connectDatabase();
  const cursor = Candidate.collection.find({ $or: [{ stage: { $in: Object.keys(stageMap) } }, { candidateType: { $exists: false } }, { languages: { $exists: false } }] });
  let updated = 0;
  for await (const candidate of cursor) {
    await Candidate.collection.updateOne({ _id: candidate._id }, { $set: migrationPatch(candidate) });
    updated += 1;
  }
  process.stdout.write(`Candidate workflow migration complete: ${updated} candidate(s) updated\n`);
  await disconnectDatabase();
}

if (require.main === module) run().catch(async (error) => { process.stderr.write(`${error.stack || error.message}\n`); await disconnectDatabase(); process.exit(1); });

module.exports = { stageMap, migrateLanguage, migrationPatch };
