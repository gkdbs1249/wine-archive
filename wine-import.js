(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COUNTRY_NAMES = {
    spain: '스페인', italy: '이탈리아', france: '프랑스', germany: '독일', portugal: '포르투갈',
    austria: '오스트리아', argentina: '아르헨티나', chile: '칠레', australia: '호주',
    'new zealand': '뉴질랜드', 'south africa': '남아프리카공화국', 'united states': '미국', usa: '미국',
  };

  function cleanLine(line) {
    return line.replace(/[^A-Za-zÀ-ÿ0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseVivinoOcr(text) {
    const normalizedText = String(text || '').normalize('NFKC');
    const rawLines = normalizedText.split(/\n/).map((line) => line.trim()).filter(Boolean);
    const lines = rawLines.map(cleanLine);
    const yearIndex = rawLines.findIndex((line) => /\b(?:19|20)\d{2}\b/.test(line));
    const vintageMatch = normalizedText.match(/\b(?:19|20)\d{2}\b/);
    const scoreMatch = normalizedText.match(/(?:^|[^0-9])([0-5])\s*[.,]\s*([0-9Oo])(?=[^0-9]|$)/m);
    const countMatch = normalizedText.match(/([\d.,]+)\s*(ratings?|평점)/i);

    let name = '';
    if (yearIndex > 0) {
      for (let index = yearIndex - 1; index >= 0; index -= 1) {
        const line = lines[index].replace(/\b(?:19|20)\d{2}\b/g, '').trim();
        if (!line || !/[A-Za-zÀ-ÿ]{3}/.test(line)) continue;
        if (/do you|like|wine|rating|among|world|insight|my wines/i.test(line)) continue;
        name = line;
        break;
      }
    }

    const countryPattern = new RegExp(`\\b(${Object.keys(COUNTRY_NAMES).sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');
    const locationLines = yearIndex >= 0 ? rawLines.slice(yearIndex + 1) : rawLines;
    const countryMatch = locationLines.map((line) => line.match(countryPattern)).find(Boolean)
      || rawLines.map((line) => line.match(countryPattern)).find(Boolean);
    const country = countryMatch ? COUNTRY_NAMES[countryMatch[1].toLowerCase()] : '';

    let count = '';
    if (countMatch) {
      const number = Number(countMatch[1].replace(/\D/g, ''));
      if (Number.isFinite(number)) count = `${number.toLocaleString('en-US')} ratings`;
    }

    let score = '';
    if (scoreMatch) {
      const candidate = `${scoreMatch[1]}.${scoreMatch[2].replace(/[Oo]/, '0')}`;
      if (Number(candidate) <= 5) score = candidate;
    }

    return {
      name,
      vintage: vintageMatch?.[0] || '',
      score,
      count,
      country,
    };
  }

  return { parseVivinoOcr };
});
