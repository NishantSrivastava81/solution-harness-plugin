const fs = require('fs');
try {
    const modTime = fs.statSync('docs/PROGRESS.md').mtime;
    const diffMin = (new Date() - modTime) / (1000 * 60);
    if (diffMin > 30) {
        const out = {
            hookSpecificOutput: {
                hookEventName: 'Stop',
                decision: 'block',
                reason: 'docs/PROGRESS.md has not been updated this session. Please log your progress before stopping: describe what was built, any issues, and what should be done next. Use /log-progress.'
            }
        };
        process.stdout.write(JSON.stringify(out));
    } else {
        process.stdout.write(JSON.stringify({}));
    }
} catch (e) {
    process.stdout.write(JSON.stringify({}));
}
