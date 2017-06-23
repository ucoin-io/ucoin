"use strict";
let should = require('should');
let _ = require('underscore');
let co = require('co');
let Q = require('q');
let Block = require('../../app/lib/entity/block');

describe('Entities', () => {

  it('testing Block', () => {
    let block = new Block({ dividend: 2 });
    block.should.have.property("dividend").equal(2);
  });
});
