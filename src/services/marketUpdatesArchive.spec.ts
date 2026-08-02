import {beforeEach,describe,expect,it,vi} from 'vitest';

const {invokeSecureFunction}=vi.hoisted(()=>({invokeSecureFunction:vi.fn()}));
vi.mock('@/lib/secureInvoke',()=>({invokeSecureFunction}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));

import {archiveMarketUpdate,restoreMarketUpdate,setMarketNewsArchiveState} from './marketUpdatesService';

const updateId='123e4567-e89b-42d3-a456-426614174000';

describe('Market News Feed archive service',()=>{
  beforeEach(()=>invokeSecureFunction.mockReset());

  it('uses one canonical endpoint and archive-state contract',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{ok:true,data:{id:updateId,isArchived:true,archivedAt:'2026-08-02T00:00:00.000Z',outcome:'archived'},correlationId:'223e4567-e89b-42d3-a456-426614174000'},error:null});
    await expect(archiveMarketUpdate(updateId)).resolves.toMatchObject({id:updateId,isArchived:true,outcome:'archived'});
    expect(invokeSecureFunction).toHaveBeenCalledOnce();
    expect(invokeSecureFunction).toHaveBeenCalledWith('market-updates-archive',{action:'set_archive_state',updateId,archived:true});
  });

  it('uses the same endpoint to restore with archived false',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{ok:true,data:{id:updateId,isArchived:false,archivedAt:null,outcome:'restored'},correlationId:'223e4567-e89b-42d3-a456-426614174000'},error:null});
    await expect(restoreMarketUpdate(updateId)).resolves.toMatchObject({id:updateId,isArchived:false,outcome:'restored'});
    expect(invokeSecureFunction).toHaveBeenCalledWith('market-updates-archive',{action:'set_archive_state',updateId,archived:false});
  });

  it('retains a failed mutation as a rejected operation with trace context',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{ok:false},error:{message:'denied',status:403,code:'MARKET_UPDATES_EDIT_REQUIRED',correlationId:'323e4567-e89b-42d3-a456-426614174000'}});
    await expect(setMarketNewsArchiveState({updateId,archived:true})).rejects.toMatchObject({issue:{httpStatus:403,correlationId:'323e4567-e89b-42d3-a456-426614174000',functionName:'market-updates-archive'}});
    expect(invokeSecureFunction).toHaveBeenCalledOnce();
  });

  it('rejects malformed successful responses instead of pretending the mutation succeeded',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{ok:true},error:null});
    await expect(setMarketNewsArchiveState({updateId,archived:true})).rejects.toThrow('Market News Feed could not complete this operation.');
  });
});
