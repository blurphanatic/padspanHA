"""Print file count (helps confirm a 'complete' zip)."""
import os
c=0
for root,_,files in os.walk('.'):
  for f in files:
    c+=1
print('files',c)
