let buf = '';
process.stdin.on('data', c => buf += c);
process.stdin.on('end', () => {
    const fs = require('fs');
    const d = JSON.parse(buf);
    if (['create_file', 'replace_string_in_file', 'run_in_terminal'].includes(d.tool_name)) {
        const entry = {
            ts: new Date().toISOString(),
            tool: d.tool_name,
            input_summary: JSON.stringify(d.tool_input || {}).slice(0, 200),
            result_summary: (d.tool_response || '').slice(0, 200)
        };
        try {
            fs.appendFileSync('docs/trajectory.jsonl', JSON.stringify(entry) + '\n');
        } catch (e) { /* docs/ may not exist yet */ }
    }
    process.stdout.write(JSON.stringify({}));
});
