-- Guard the original generated copy and service IDs; preserve admin edits and order snapshots.
UPDATE pedia_tiers
SET description_md='Followers Instagram untuk target publik. Akun lama menurut label layanan.', updated_at=datetime('now')
WHERE id=47 AND supplier='indosmm' AND supplier_service_id=7887
  AND description_md='Followers Instagram untuk target publik. Pilihan dengan akun berpostingan menurut keterangan layanan.';

UPDATE pedia_tiers
SET description_md=replace(description_md, ', akun real/aktif.', ', label Real.'), updated_at=datetime('now')
WHERE supplier='indosmm'
  AND supplier_service_id IN (6405,575,4589,6771,8799,8066,7589,3679,6386,8399,6381,7967,7426,9408,7319,9415,9416,5959,7971,5476,9331,9330,7985,7986,8461,9424,6773,4308,8643,8463,6789,6762,6412,574,8843,5503,6772,7434,4836,8436,7914,8793,8348,8350,8359,8754,8041,9042,6102,8761,6048,2336,8385,8346,8328,8353,7207,2542,5744,8230,6776,6779,6791,6765)
  AND description_md IN ('Followers global, akun real/aktif.', 'Followers dari akun Indonesia, akun real/aktif.', 'Likes global, akun real/aktif.', 'Likes dari akun Indonesia, akun real/aktif.', 'Views global, akun real/aktif.', 'Saves global, akun real/aktif.', 'Saves dari akun Indonesia, akun real/aktif.', 'Shares dari akun Indonesia, akun real/aktif.', 'Reposts global, akun real/aktif.', 'Reposts dari akun Indonesia, akun real/aktif.', 'Komentar dari akun Indonesia, akun real/aktif.', 'Komentar custom dari akun Indonesia, akun real/aktif.');
