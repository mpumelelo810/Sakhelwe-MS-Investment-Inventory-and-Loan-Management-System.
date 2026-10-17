const LIVESTOCK_KINDS=new Set(["opening_stock","receive","sale","mortality","loss"]);

// Pure reconciliation logic so stale offline product references can be tested
// without touching a real workspace or posting records to Supabase.
export function reconcileQueuedLivestockProduct(kind,payload,products){
 if(!LIVESTOCK_KINDS.has(kind))return payload;
 const currentId=String(payload?.product_id||"").trim();
 const division=String(payload?.division||"").trim();
 const catalog=Array.isArray(products)?products:[];
 const currentProduct=catalog.find(product=>product.id===currentId);
 if(currentProduct&&(!["Pigs","Poultry"].includes(division)||currentProduct.division===division))return payload;
 if(!["Pigs","Poultry"].includes(division))throw Error("A pending livestock entry references a product that cannot be matched safely. Its entry is still on this device; do not clear the queue.");
 const match=catalog.find(product=>product.division===division);
 if(!match)throw Error("No current livestock product exists for "+division+". The pending entry is still on this device.");
 return {...payload,product_id:match.id};
}
