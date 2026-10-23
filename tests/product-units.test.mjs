import test from 'node:test';
import assert from 'node:assert/strict';
import {tsLoader} from './helpers/load-ts.mjs';
const {productUnits,stockDisplay,stockParts,unitSalePrice}=tsLoader()('lib/productUnits.ts');
const pack={packaging_enabled:true,base_unit:'Piece',pieces_per_packet:10,packets_per_box:10,sale_price:15,packet_sale_price:140,box_sale_price:1300};
test('unconfigured products keep original units; configured products expose valid choices',()=>{
 assert.deepEqual(productUnits({}),[{value:'unit',label:'Unit',factor:1}]);
 assert.deepEqual(productUnits(pack).map(u=>[u.value,u.factor]),[['piece',1],['packet',10],['box',100]]);
 assert.deepEqual(productUnits({...pack,pieces_per_packet:1}).map(u=>u.value),['piece','packet','box']);
});
test('pack prices use explicit overrides and fall back to the base price',()=>{
 assert.equal(unitSalePrice(pack,'packet'),140);assert.equal(unitSalePrice(pack,'box'),1300);assert.equal(unitSalePrice({...pack,packet_sale_price:0},'packet'),150);
});
test('stock breakdown describes equivalents without claiming sealed packages',()=>{
 assert.equal(stockDisplay(187,pack),'18 Packet + 7 Piece equivalent (187 Piece total)');assert.equal(stockDisplay(0,pack),'0 Packet equivalent (0 Piece total)');assert.equal(stockDisplay(5,{}),'5 units');
});

test('vial kits use existing factors and kit prices without changing stored stock',()=>{
 const kit={...pack,base_unit:'Vial',pieces_per_packet:10,packets_per_box:1,sale_price:100,packet_sale_price:1000};
 assert.deepEqual(productUnits(kit).map(u=>[u.value,u.label,u.factor]),[['piece','Vial',1],['packet','Kit (10 Vial)',10]]);
 assert.equal(stockDisplay(29,kit),'2 Kit + 9 Vial equivalent (29 Vial total)');
 assert.equal(unitSalePrice(kit,'packet'),1000);assert.equal(unitSalePrice(kit,'piece'),100);
 assert.equal(stockDisplay(1,kit),'0 Kit + 1 Vial equivalent (1 Vial total)');
});

test('kit input conversion preserves extra loose stock and decimal quantities',()=>{
 const p={packaging_enabled:true,pieces_per_packet:3};
 assert.deepEqual(stockParts(10,p),{packs:3,loose:1,size:3});
 assert.deepEqual(stockParts(10.25,p),{packs:3,loose:1.25,size:3});
 assert.deepEqual(stockParts(0,p),{packs:0,loose:0,size:3});
});
