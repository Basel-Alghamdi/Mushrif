"use client";

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

export function usePersistentState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>,boolean]{
  const [value,setValue]=useState<T>(initial);
  const [ready,setReady]=useState(false);
  const first=useRef(true);
  useEffect(()=>{
    try{const stored=localStorage.getItem(key);if(stored)setValue(JSON.parse(stored) as T)}catch{/* retain safe seed */}
    setReady(true);
  },[key]);
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{if(event.key===key&&event.newValue){try{setValue(JSON.parse(event.newValue) as T)}catch{/* ignore malformed external state */}}};
    const sameTab=(event:Event)=>{const detail=(event as CustomEvent<{key:string;value:T}>).detail;if(detail?.key===key)setValue(detail.value)};
    window.addEventListener("storage",sync);
    window.addEventListener("rasd:store",sameTab);
    return()=>{window.removeEventListener("storage",sync);window.removeEventListener("rasd:store",sameTab)};
  },[key]);
  useEffect(()=>{
    if(first.current){first.current=false;return}
    if(!ready)return;
    localStorage.setItem(key,JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("rasd:store",{detail:{key,value}}));
  },[key,ready,value]);
  return [value,setValue,ready];
}

async function apiRequest(path:string,options:RequestInit={}){
  const isForm=options.body instanceof FormData;
  const token=typeof window!=="undefined"?localStorage.getItem("rasd:token"):null;
  const response=await fetch(`${process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000"}/api/v1${path}`,{...options,headers:{...(isForm||!options.body?{}:{"content-type":"application/json"}),...(token?{authorization:`Bearer ${token}`}:{ }),...(options.headers??{})}});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(payload?.error?.message??"تعذّر الحفظ — أعيدي المحاولة"),{status:response.status,payload});
  return payload?.data;
}

export function apiRead(path:string,options:RequestInit={}){return apiRequest(path,{...options,method:options.method??"GET"})}
export function apiWrite(path:string,options:RequestInit){return apiRequest(path,options)}
