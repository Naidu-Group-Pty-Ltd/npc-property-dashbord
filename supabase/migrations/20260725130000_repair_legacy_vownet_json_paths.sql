-- Normalize legacy Vownet upload responses to the object key used in storage.
-- The matching binding may already exist; fresh databases can instead have a
-- binding whose object_path is the unparsed JSON value.
WITH legacy_vownet_files AS (
  SELECT id,
         client_id,
         uploaded_by,
         is_vownet_form,
         (file_path::jsonb ->> 'path') AS object_path
  FROM public.client_files
  WHERE file_path LIKE '{%'
    AND (file_path::jsonb ->> 'path') LIKE 'vownet-forms/%'
    AND (file_path::jsonb ->> 'fullPath') =
        'client-files/' || (file_path::jsonb ->> 'path')
)
INSERT INTO public.storage_object_bindings (
  bucket,
  object_path,
  resource_type,
  resource_id,
  client_id,
  owner_user_id,
  sensitivity,
  created_by
)
SELECT 'client-files',
       object_path,
       CASE WHEN is_vownet_form THEN 'vownet_form' ELSE 'client_file' END,
       id,
       client_id,
       uploaded_by,
       'sensitive',
       uploaded_by
FROM legacy_vownet_files
ON CONFLICT (bucket, object_path) DO NOTHING;

UPDATE public.client_files
SET file_path = (file_path::jsonb ->> 'path'),
    storage_bucket = 'client-files'
WHERE file_path LIKE '{%'
  AND (file_path::jsonb ->> 'path') LIKE 'vownet-forms/%'
  AND (file_path::jsonb ->> 'fullPath') =
      'client-files/' || (file_path::jsonb ->> 'path');
