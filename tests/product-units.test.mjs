import test from 'node:test';
import assert from 'node:assert/strict';
import {tsLoader} from './helpers/load-ts.mjs';
const {productUnits,stockDisplay,unitSalePrice}=tsLoader()('lib/productUnits.ts');
const pack={packaging_enabled:true,base_unit:'Piece',pieces_per_packet:10,packets_per_box:10,sale_price:15,packet_sale_price:140,box_sale_price:1300};
test('unconfigured products keep original units; configured products expose valid choices',()=>{
 assert.deepEqual(productUnits({}),[{value:'unit',label:'Unit',factor:1}]);
 assert.deepEqual(productUnits(pack).map(u=>[u.value,u.factor]),[['piece',1],['packet',10],['box',100]]);
 assert.deepEqual(productUnits({...pack,pieces_per_packet:1}).map(u=>u.value),['piece','box']);
});
test('pack prices use explicit overrides and fall back to the base price',()=>{
 assert.equal(unitSalePrice(pack,'packet'),140);assert.equal(unitSalePrice(pack,'box'),1300);assert.equal(unitSalePrice({...pack,packet_sale_price:0},'packet'),150);
});
test('stock breakdown describes equivalents without claiming sealed packages',()=>{
 assert.equal(stockDisplay(187,pack),'187 Piece (1 box + 8 packet + 7 Piece equivalent)');assert.equal(stockDisplay(0,pack),'0 Piece (0 Piece equivalent)');assert.equal(stockDisplay(5,{}),'5 units');
});
