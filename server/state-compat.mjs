// Older clients omit the newly shared reviews. Only that omission inherits data;
// an explicit array (including []) remains the client's intended update.
// Call after fingerprinting the original request and checking its revision.
export function preserveLegacyArticleReviews(incoming,current){
 const state=structuredClone(incoming),storedWeeks=new Map(current.weeks.map(w=>[w.id,w]));
 for(const week of state.weeks){
  const stored=storedWeeks.get(week.id);
  if(!Object.hasOwn(week,'articleReviews')&&stored&&Object.hasOwn(stored,'articleReviews'))week.articleReviews=structuredClone(stored.articleReviews);
 }
 return state;
}
