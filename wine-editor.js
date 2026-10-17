(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function stringValue(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function formValuesForWine(wine = {}) {
    return {
      name: stringValue(wine.name),
      vintage: stringValue(wine.vintage),
      country: stringValue(wine.country),
      externalScore: wine.externalScore === null || wine.externalScore === undefined ? '' : String(wine.externalScore),
      externalCount: stringValue(wine.externalCount),
      date: stringValue(wine.date),
      people: stringValue(wine.people),
      place: stringValue(wine.place),
      kind: stringValue(wine.kind),
      food: stringValue(wine.food),
      note: stringValue(wine.note),
      image: stringValue(wine.image),
    };
  }

  function buildEditedWine(wine, fields = {}, replacementImage = '') {
    return {
      ...wine,
      name: stringValue(fields.name),
      vintage: stringValue(fields.vintage),
      country: stringValue(fields.country),
      externalScore: stringValue(fields.externalScore),
      externalCount: stringValue(fields.externalCount),
      date: stringValue(fields.date),
      people: stringValue(fields.people),
      place: stringValue(fields.place),
      kind: stringValue(fields.kind),
      food: stringValue(fields.food),
      note: stringValue(fields.note),
      image: replacementImage || stringValue(wine?.image),
      custom: wine?.custom === true,
    };
  }

  return { formValuesForWine, buildEditedWine };
});
