/**
 * utils.js
 * * Contains generic helper and utility functions, like parsers.
 */

/**
 * Parses M3U playlist data into a structured array of channel objects.
 * @param {string} data - The raw M3U content as a string.
 * @returns {Array<object>} - An array of channel objects.
 */
export function parseM3U(data) {
    if (!data) return [];
    const lines = data.split('\n');
    const channels = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const nextLine = lines[i + 1]?.trim();
            // Ensure the next line is a valid URL
            if (nextLine && (nextLine.startsWith('http') || nextLine.startsWith('rtp'))) {
                const idMatch = line.match(/tvg-id="([^"]*)"/);
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                const nameMatch = line.match(/tvg-name="([^"]*)"/);
                const groupMatch = line.match(/group-title="([^"]*)"/);
                const chnoMatch = line.match(/tvg-chno="([^"]*)"/);
                const sourceMatch = line.match(/vini-source="([^"]*)"/);
                const commaIndex = line.lastIndexOf(',');
                const displayName = (commaIndex !== -1) ? line.substring(commaIndex + 1).trim() : 'Unknown';

                channels.push({
                    id: idMatch ? idMatch[1] : `unknown-${Math.random()}`,
                    logo: logoMatch ? logoMatch[1] : '',
                    name: nameMatch ? nameMatch[1] : displayName,
                    group: groupMatch ? groupMatch[1] : 'Uncategorized',
                    chno: chnoMatch ? chnoMatch[1] : null,
                    source: sourceMatch ? sourceMatch[1] : 'Default',
                    displayName: displayName,
                    url: nextLine
                });
                i++; // Skip the URL line in the next iteration
            }
        }
    }
    return channels;
}
