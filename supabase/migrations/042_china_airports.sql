-- 042_china_airports.sql
-- Add major Chinese airports (origin/international cities) so China shows in the
-- Visa Group form's arrival "From (city)" and departure "To (city)" dropdowns.
-- Non-Saudi (is_saudi=false); Saudi arrival/departure fields are unaffected.
insert into airports (code, name, city, country, is_saudi) values
('PEK','Beijing Capital International','Beijing','China',false),
('PKX','Beijing Daxing International','Beijing','China',false),
('PVG','Shanghai Pudong International','Shanghai','China',false),
('SHA','Shanghai Hongqiao International','Shanghai','China',false),
('CAN','Guangzhou Baiyun International','Guangzhou','China',false),
('SZX','Shenzhen Bao''an International','Shenzhen','China',false),
('CTU','Chengdu Shuangliu International','Chengdu','China',false),
('TFU','Chengdu Tianfu International','Chengdu','China',false),
('CKG','Chongqing Jiangbei International','Chongqing','China',false),
('KMG','Kunming Changshui International','Kunming','China',false),
('XIY','Xi''an Xianyang International','Xi''an','China',false),
('URC','Ürümqi Diwopu International','Ürümqi','China',false),
('KHG','Kashgar Airport','Kashgar','China',false),
('YIN','Yining Airport','Yining','China',false),
('INC','Yinchuan Hedong International','Yinchuan','China',false),
('LHW','Lanzhou Zhongchuan International','Lanzhou','China',false),
('XNN','Xining Caojiabao International','Xining','China',false),
('HET','Hohhot Baita International','Hohhot','China',false),
('WUH','Wuhan Tianhe International','Wuhan','China',false),
('CSX','Changsha Huanghua International','Changsha','China',false),
('HGH','Hangzhou Xiaoshan International','Hangzhou','China',false),
('NKG','Nanjing Lukou International','Nanjing','China',false),
('XMN','Xiamen Gaoqi International','Xiamen','China',false),
('TAO','Qingdao Jiaodong International','Qingdao','China',false),
('DLC','Dalian Zhoushuizi International','Dalian','China',false),
('SHE','Shenyang Taoxian International','Shenyang','China',false),
('HRB','Harbin Taiping International','Harbin','China',false),
('TSN','Tianjin Binhai International','Tianjin','China',false),
('KWE','Guiyang Longdongbao International','Guiyang','China',false),
('NNG','Nanning Wuxu International','Nanning','China',false),
('HAK','Haikou Meilan International','Haikou','China',false),
('SYX','Sanya Phoenix International','Sanya','China',false),
('FOC','Fuzhou Changle International','Fuzhou','China',false)
on conflict (code) do nothing;
