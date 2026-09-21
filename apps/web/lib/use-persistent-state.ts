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
    if(first.current){first.current=false;return}
    if(!ready)return;
    localStorage.setItem(key,JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("rasd:store",{detail:{key,value}}));
  },[key,ready,value]);
  return [value,setValue,ready];
}

export async function apiWrite(path:string,options:RequestInit){
  const response=await fetch(`http://localhost:4000/api/v1${path}`,{...options,headers:{"content-type":"application/json",...(options.headers??{})}});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(payload?.error?.message??"تعذّر الحفظ — أعيدي المحاولة"),{status:response.status,payload});
  return payload?.data;
}
