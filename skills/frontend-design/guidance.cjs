'use strict';

const fs = require('node:fs');
const path = require('node:path');

function frontendGuidance() {
    const skill = fs.readFileSync(path.join(__dirname, 'SKILL.md'), 'utf8');
    const body = /^---\r?\n[\s\S]*?\r?\n---\r?\n+([\s\S]+)$/.exec(skill);
    if (!body) throw new Error('Bundled frontend-design skill has invalid frontmatter');
    return `UI/UX guidance applies only to interface work and must respect your assigned role and scope.\n\n${body[1].trim()}`;
}

module.exports = { frontendGuidance };
