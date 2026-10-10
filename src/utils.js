import{ageWeeks,ageCategory}from"./model.js";

export const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Mbabane"}).format(new Date());
export const money=n=>"E "+Number(n||0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
export const uuid=()=>crypto.randomUUID();
export const age=b=>ageWeeks(b,today());
export const cat=ageCategory;
