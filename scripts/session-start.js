const fs = require('fs');
try {
    const f = JSON.parse(fs.readFileSync('docs/FEATURES.json', 'utf8'));
    const total = f.features.length;
    const done = f.features.filter(x => x.status === 'complete').length;
    const rework = f.features.filter(x => x.status === 'needs-rework').length;
    const blocked = f.features.filter(x => x.status === 'blocked').length;
    const existing = f.features.filter(x => x.status === 'existing').length;
    const next = f.features.find(x => x.status === 'needs-rework' || x.status === 'not-started');
    const active = total - existing;
    const out = {
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `PROJECT STATUS: ${done}/${active} features complete (${existing} existing/onboarded). ${rework} need rework. ${blocked} blocked. Next: ${next ? next.id + ' - ' + next.name : 'ALL DONE'}. IMPORTANT: Read docs/PROGRESS.md before starting work.`
        }
    };
    process.stdout.write(JSON.stringify(out));
} catch (e) {
    const out = {
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'No docs/FEATURES.json found. Run /init-solution or /onboard to set up the harness.'
        }
    };
    process.stdout.write(JSON.stringify(out));
}
