'use strict';

function Dayjs(input) {
  this.$d = input instanceof Dayjs ? new Date(input.valueOf()) : input === undefined ? new Date() : new Date(input);
  this.$L = 'en';
}

Dayjs.prototype.clone = function () { return new Dayjs(this); };
Dayjs.prototype.isValid = function () { return !Number.isNaN(this.$d.getTime()); };
Dayjs.prototype.valueOf = function () { return this.$d.getTime(); };
Dayjs.prototype.unix = function () { return Math.floor(this.valueOf() / 1000); };
Dayjs.prototype.toDate = function () { return new Date(this.valueOf()); };
Dayjs.prototype.toISOString = function () { return this.$d.toISOString(); };
Dayjs.prototype.toJSON = function () { return this.isValid() ? this.toISOString() : null; };
Dayjs.prototype.locale = function (name) { if (name) this.$L = name; return name ? this : this.$L; };
Dayjs.prototype.utcOffset = function () { return -this.$d.getTimezoneOffset(); };
Dayjs.prototype.year = function (value) { return value === undefined ? this.$d.getFullYear() : this.set('year', value); };
Dayjs.prototype.month = function (value) { return value === undefined ? this.$d.getMonth() : this.set('month', value); };
Dayjs.prototype.date = function (value) { return value === undefined ? this.$d.getDate() : this.set('date', value); };
Dayjs.prototype.day = function (value) { return value === undefined ? this.$d.getDay() : this.add(value - this.$d.getDay(), 'day'); };
Dayjs.prototype.hour = function (value) { return value === undefined ? this.$d.getHours() : this.set('hour', value); };
Dayjs.prototype.minute = function (value) { return value === undefined ? this.$d.getMinutes() : this.set('minute', value); };
Dayjs.prototype.second = function (value) { return value === undefined ? this.$d.getSeconds() : this.set('second', value); };
Dayjs.prototype.millisecond = function (value) { return value === undefined ? this.$d.getMilliseconds() : this.set('millisecond', value); };
Dayjs.prototype.set = function (unit, value) {
  const next = this.clone();
  const setters = { year: 'setFullYear', month: 'setMonth', date: 'setDate', day: 'setDate', hour: 'setHours', minute: 'setMinutes', second: 'setSeconds', millisecond: 'setMilliseconds' };
  const setter = setters[String(unit).toLowerCase()];
  if (setter) next.$d[setter](value);
  return next;
};
Dayjs.prototype.get = function (unit) { const method = this[String(unit).toLowerCase()]; return typeof method === 'function' ? method.call(this) : undefined; };
Dayjs.prototype.add = function (amount, unit) {
  const next = this.clone();
  const normalized = String(unit).toLowerCase();
  if (normalized.startsWith('year')) next.$d.setFullYear(next.$d.getFullYear() + amount);
  else if (normalized.startsWith('month')) next.$d.setMonth(next.$d.getMonth() + amount);
  else {
    const multiplier = normalized.startsWith('week') ? 604800000 : normalized.startsWith('day') ? 86400000 : normalized.startsWith('hour') ? 3600000 : normalized.startsWith('minute') ? 60000 : normalized.startsWith('second') ? 1000 : 1;
    next.$d = new Date(next.valueOf() + amount * multiplier);
  }
  return next;
};
Dayjs.prototype.subtract = function (amount, unit) { return this.add(-amount, unit); };
Dayjs.prototype.startOf = function (unit) {
  const next = this.clone();
  const normalized = String(unit).toLowerCase();
  if (normalized === 'year') { next.$d.setMonth(0, 1); next.$d.setHours(0, 0, 0, 0); }
  else if (normalized === 'month') { next.$d.setDate(1); next.$d.setHours(0, 0, 0, 0); }
  else if (normalized === 'day' || normalized === 'date') next.$d.setHours(0, 0, 0, 0);
  else if (normalized === 'hour') next.$d.setMinutes(0, 0, 0);
  else if (normalized === 'minute') next.$d.setSeconds(0, 0);
  else if (normalized === 'second') next.$d.setMilliseconds(0);
  return next;
};
Dayjs.prototype.endOf = function (unit) { return this.startOf(unit).add(1, unit).subtract(1, 'millisecond'); };
Dayjs.prototype.isAfter = function (other) { return this.valueOf() > dayjs(other).valueOf(); };
Dayjs.prototype.isBefore = function (other) { return this.valueOf() < dayjs(other).valueOf(); };
Dayjs.prototype.isSame = function (other) { return this.valueOf() === dayjs(other).valueOf(); };
Dayjs.prototype.diff = function (other) { return this.valueOf() - dayjs(other).valueOf(); };
Dayjs.prototype.daysInMonth = function () { return new Date(this.year(), this.month() + 1, 0).getDate(); };
Dayjs.prototype.format = function () { return this.isValid() ? this.toISOString() : 'Invalid Date'; };

function dayjs(input) { return input instanceof Dayjs ? input.clone() : new Dayjs(input); }
dayjs.extend = function (plugin, option) { if (typeof plugin === 'function') plugin(option, Dayjs, dayjs); return dayjs; };
dayjs.locale = function (name) { return name || 'en'; };
dayjs.isDayjs = function (value) { return value instanceof Dayjs; };
dayjs.unix = function (seconds) { return dayjs(seconds * 1000); };
dayjs.Ls = { en: {} };
dayjs.en = {};
dayjs.p = {};
dayjs.prototype = Dayjs.prototype;

module.exports = dayjs;
module.exports.default = dayjs;
