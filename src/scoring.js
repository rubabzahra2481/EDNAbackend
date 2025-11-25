/**
 * E-DNA Quiz Scoring Logic (Backend)
 * Calculates scores for all 7 layers based on user answers
 */

/**
 * Calculate Layer 1: Decision Identity
 */
function calculateLayer1(answers) {
  let architectCount = 0;
  let alchemistCount = 0;

  for (let i = 1; i <= 8; i++) {
    const answer = answers[`L1_Q${i}`];
    if (answer === 'a') architectCount++;
    if (answer === 'b') alchemistCount++;
  }

  let type;
  
  if (architectCount === 8 && alchemistCount === 0) {
    type = 'Strong Architect';
  } else if (architectCount === 7 && alchemistCount === 1) {
    type = 'Medium Architect';
  } else if (architectCount === 6 && alchemistCount === 2) {
    type = 'Weak Architect';
  } else if (architectCount === 0 && alchemistCount === 8) {
    type = 'Strong Alchemist';
  } else if (architectCount === 1 && alchemistCount === 7) {
    type = 'Medium Alchemist';
  } else if (architectCount === 2 && alchemistCount === 6) {
    type = 'Weak Alchemist';
  } else {
    type = 'Blurred';
  }

  return { type, architectCount, alchemistCount };
}

/**
 * Calculate Layer 2: Execution Style Subtype
 */
function calculateLayer2(answers, layer1Result) {
  const scores = {};
  
  // Determine which path based on Layer 1
  let path;
  let questionPrefix;
  
  if (layer1Result.type.includes('Architect')) {
    path = 'architect';
    questionPrefix = 'L2_Q';
  } else if (layer1Result.type.includes('Alchemist')) {
    path = 'alchemist';
    questionPrefix = 'L2_Q';
  } else {
    path = 'mixed';
    questionPrefix = 'L2_Qm';
  }

  // Count scores for each subtype
  for (let i = 9; i <= 16; i++) {
    const qid = path === 'alchemist' ? `${questionPrefix}${i}a` : `${questionPrefix}${i}`;
    const answer = answers[qid];
    
    if (answer) {
      let scoreKey = '';
      if (path === 'architect') {
        const mapping = {
          'a': 'planner',
          'b': 'operator',
          'c': 'analyst',
          'd': 'ultimate'
        };
        scoreKey = mapping[answer] || '';
      } else if (path === 'alchemist') {
        const mapping = {
          'a': 'oracle',
          'b': 'perfectionist',
          'c': 'empath',
          'd': 'ultimate'
        };
        scoreKey = mapping[answer] || '';
      }
      
      if (scoreKey) {
        scores[scoreKey] = (scores[scoreKey] || 0) + 1;
      }
    }
  }

  // Determine dominant subtype
  let subtype = '';
  let maxScore = 0;
  for (const [key, value] of Object.entries(scores)) {
    if (value > maxScore) {
      maxScore = value;
      subtype = key;
    }
  }

  // Capitalize subtype
  subtype = subtype.charAt(0).toUpperCase() + subtype.slice(1);

  return { subtype, path, scores };
}

/**
 * Calculate Layer 3: Mirror Awareness
 */
function calculateLayer3(answers) {
  const dimensions = {};
  let totalScore = 0;
  const maxScore = 12;

  const dimensionMap = {
    'L3_Q17': { name: 'Validator Awareness', labels: ['Opposite', 'Partial', 'Full'] },
    'L3_Q18': { name: 'Emotional Regulation', labels: ['Reactive', 'Aware', 'Integrated'] },
    'L3_Q19': { name: 'Feedback Processing', labels: ['Defensive', 'Selective', 'Open'] },
    'L3_Q20': { name: 'Blind Spot Recognition', labels: ['Unaware', 'Emerging', 'Aware'] },
    'L3_Q21': { name: 'Self-Correction Speed', labels: ['Slow', 'Moderate', 'Fast'] },
    'L3_Q22': { name: 'Growth Orientation', labels: ['Fixed', 'Mixed', 'Growth'] }
  };

  for (const [qid, dimData] of Object.entries(dimensionMap)) {
    const answer = answers[qid];
    let score = 0;
    let label = '';

    if (answer === 'a') { score = 0; label = dimData.labels[0]; }
    else if (answer === 'b') { score = 1; label = dimData.labels[1]; }
    else if (answer === 'c') { score = 2; label = dimData.labels[2]; }

    dimensions[dimData.name] = { score, label };
    totalScore += score;
  }

  return { totalScore, maxScore, dimensions };
}

/**
 * Calculate Layer 4: Learning Style (VARK)
 */
function calculateLayer4(answers) {
  const scores = {
    visual: 0,
    auditory: 0,
    readWrite: 0,
    kinesthetic: 0
  };

  const mapping = {
    'a': 'visual',
    'b': 'auditory',
    'c': 'readWrite',
    'd': 'kinesthetic'
  };

  for (let i = 23; i <= 27; i++) {
    const answer = answers[`L4_Q${i}`];
    if (answer && mapping[answer]) {
      scores[mapping[answer]]++;
    }
  }

  const total = Object.values(scores).reduce((sum, val) => sum + val, 0);
  const percentages = {
    visual: Math.round((scores.visual / total) * 100),
    auditory: Math.round((scores.auditory / total) * 100),
    readWrite: Math.round((scores.readWrite / total) * 100),
    kinesthetic: Math.round((scores.kinesthetic / total) * 100)
  };

  let dominantModality = 'visual';
  let maxScore = scores.visual;
  for (const [key, value] of Object.entries(scores)) {
    if (value > maxScore) {
      maxScore = value;
      dominantModality = key;
    }
  }

  return { dominantModality, scores, percentages };
}

/**
 * Calculate Layer 5: Neuro Performance
 */
function calculateLayer5(answers) {
  const profile = {};

  const dimensions = [
    { qid: 'L5_Q28', name: 'Focus Pattern' },
    { qid: 'L5_Q29', name: 'Processing Speed' },
    { qid: 'L5_Q30', name: 'Energy Pattern' },
    { qid: 'L5_Q31', name: 'Task Switching' },
    { qid: 'L5_Q32', name: 'Stress Response' },
    { qid: 'L5_Q33', name: 'Recovery Pattern' }
  ];

  for (const dim of dimensions) {
    const answer = answers[dim.qid];
    if (answer) {
      profile[dim.name] = answer;
    }
  }

  return { profile };
}

/**
 * Calculate Layer 6: Mindset & Personality
 */
function calculateLayer6(answers) {
  const mindset = {
    growthFixed: answers['L6_Q34'] === 'a' ? 'Growth' : 'Fixed',
    abundanceScarcity: answers['L6_Q35'] === 'a' ? 'Abundance' : 'Scarcity',
    challengeComfort: answers['L6_Q36'] === 'a' ? 'Challenge' : 'Comfort'
  };

  const q37 = answers['L6_Q37'];
  const q38 = answers['L6_Q38'];
  let coreType = '';
  
  if (q37 === 'a' && q38 === 'a') coreType = 'Confident & Steady';
  else if (q37 === 'a' && q38 === 'b') coreType = 'Confident & Driven';
  else if (q37 === 'b' && q38 === 'a') coreType = 'Considerate & Steady';
  else if (q37 === 'b' && q38 === 'b') coreType = 'Fast-Moving & Adaptive';

  const communicationStyle = answers['L6_Q39'] === 'a' ? 'Direct Communicator' : 'Diplomatic Communicator';

  return {
    mindset,
    personality: { coreType, communicationStyle }
  };
}

/**
 * Calculate Layer 7: Meta-Beliefs & Values
 */
function calculateLayer7(answers) {
  const beliefs = {};

  const mapping = {
    'L7_Q40': { name: 'Grounding Source', labels: ['Self-Reliant', 'Faith-Reliant', 'Dual-Reliant'] },
    'L7_Q41': { name: 'Control Belief', labels: ["I'm In Control", 'Life Influences Me', 'Shared Control'] },
    'L7_Q42': { name: 'Fairness View', labels: ['Responsibility View', 'Compassion View', 'Balanced View'] },
    'L7_Q43': { name: 'Honesty Style', labels: ['Direct Honesty', 'Gentle Honesty', 'Balanced Honesty'] },
    'L7_Q44': { name: 'Growth Approach', labels: ['Growth Focused', 'Comfort Focused', 'Steady Growth'] },
    'L7_Q45': { name: 'Impact Motivation', labels: ['Self-Focused Impact', 'Others-Focused Impact', 'Shared Impact'] }
  };

  for (const [qid, data] of Object.entries(mapping)) {
    const answer = answers[qid];
    if (answer) {
      const index = answer.charCodeAt(0) - 97;
      beliefs[data.name] = data.labels[index] || '';
    }
  }

  return { beliefs };
}

/**
 * Calculate all results
 */
function calculateAllResults(answers) {
  const layer1 = calculateLayer1(answers);
  const layer2 = calculateLayer2(answers, layer1);
  const layer3 = calculateLayer3(answers);
  const layer4 = calculateLayer4(answers);
  const layer5 = calculateLayer5(answers);
  const layer6 = calculateLayer6(answers);
  const layer7 = calculateLayer7(answers);

  return {
    layer1,
    layer2,
    layer3,
    layer4,
    layer5,
    layer6,
    layer7
  };
}

export {
  calculateAllResults,
  calculateLayer1,
  calculateLayer2,
  calculateLayer3,
  calculateLayer4,
  calculateLayer5,
  calculateLayer6,
  calculateLayer7
};
