let buf = '';
process.stdin.on('data', c => buf += c);
process.stdin.on('end', () => {
    const d = JSON.parse(buf);
    if (d.tool_name === 'run_in_terminal') {
        const cmd = (d.tool_input && (d.tool_input.command || '')).toLowerCase();
        const dangerous = ['rm -rf /', 'drop table', 'drop database', 'format c', 'del /f /s /q', 'rmdir /s /q c:\\'];
        const found = dangerous.find(x => cmd.includes(x));
        if (found) {
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'BLOCKED: Dangerous command detected (' + found + '). This command could cause data loss.'
                }
            }));
        } else {
            process.stdout.write(JSON.stringify({}));
        }
    } else {
        process.stdout.write(JSON.stringify({}));
    }
});
