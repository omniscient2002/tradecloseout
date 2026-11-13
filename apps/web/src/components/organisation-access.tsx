'use client';
import {createContext,useContext} from 'react';
export const OrganisationReadOnlyContext=createContext(false);
export const useOrganisationReadOnly=()=>useContext(OrganisationReadOnlyContext);
